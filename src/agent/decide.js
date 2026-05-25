import { supabase } from '../supabase'
import {
  buildScoringSystemPrompt,
  buildScoringPrompt,
  buildReplyClassificationPrompt,
  buildFollowUpPrompt,
  buildRejectionPrompt
} from './prompts'
import { declineOnPlatform } from '../integrations'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function callClaude(fnName, body) {
  const res = await fetch(`${FUNCTIONS_URL}/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Edge function ${fnName} failed: ${await res.text()}`)
  const data = await res.json()
  return data.text
}

// =============================================
// SCORE A LEAD + GENERATE INITIAL DRAFT
// =============================================
export async function scoreLead(lead, hotelId) {
  // 1. Fetch hotel profile
  const { data: profile } = await supabase
    .from('hotel_profiles')
    .select('*, hotels(name)')
    .eq('hotel_id', hotelId)
    .single()

  if (!profile) throw new Error('Hotel profile not found')

  const hotelProfile = {
    ...profile,
    hotel_name: profile.hotels?.name
  }

  // 2. Check hard rejection criteria BEFORE scoring
  // These are non-negotiable — capacity exceeded, dates fully blocked, etc.
  const hardRejection = checkHardRejections(lead, hotelProfile)
  if (hardRejection) {
    return await autoRejectLead(lead, hotelId, hotelProfile, hardRejection)
  }

  // 3. Check availability for requested dates
  const availabilityContext = await getAvailabilityContext(
    hotelId,
    lead.dates_requested
  )

  // 4. Call Claude for scoring + draft email (via secure Edge Function)
  const systemPrompt = buildScoringSystemPrompt(hotelProfile)
  const userPrompt = buildScoringPrompt(lead, availabilityContext)

  const raw = await callClaude('score-lead', { systemPrompt, userPrompt })
  let decision
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    decision = JSON.parse(cleaned)
  } catch {
    throw new Error(`Agent returned invalid JSON: ${raw}`)
  }

  // 6. Store decision in Supabase
  const { data, error } = await supabase
    .from('lead_decisions')
    .upsert({
      lead_id: lead.id,
      hotel_id: hotelId,
      score: decision.score,
      reasoning: decision.reasoning,
      draft_subject: decision.draft_subject,
      draft_body: decision.draft_body
    })
    .select()
    .single()

  if (error) throw error

  // 7. Mark lead as processed
  await supabase
    .from('leads')
    .update({ status: 'processed' })
    .eq('id', lead.id)

  // 8. Generate follow-up sequence (Day 3, 7, 14)
  if (decision.score !== 'cold') {
    await scheduleFollowUps(lead, hotelId, hotelProfile, decision.draft_body)
  }

  return data
}

// =============================================
// HARD REJECTION DETECTION
// Checks non-negotiable criteria before scoring.
// Returns a rejection reason string, or null if ok.
// =============================================
function checkHardRejections(lead, hotelProfile) {
  const roomsRequested = lead.group_size ?? 0
  const hotelCapacity = hotelProfile.room_count ?? 999
  const hotelMinimum = hotelProfile.min_group_size ?? 0

  // Group exceeds physical hotel capacity
  if (roomsRequested > hotelCapacity) {
    return `Group is requesting ${roomsRequested} rooms but the hotel's maximum capacity is ${hotelCapacity} rooms. This cannot be accommodated.`
  }

  // Group is below the hotel's minimum group size
  if (hotelMinimum > 0 && roomsRequested > 0 && roomsRequested < hotelMinimum) {
    return `Group size of ${roomsRequested} rooms is below the hotel's minimum group requirement of ${hotelMinimum} rooms.`
  }

  // Budget is less than 50% of minimum rate — too far off to work with
  if (lead.budget_per_night && hotelProfile.rate_min) {
    const budgetRatio = lead.budget_per_night / hotelProfile.rate_min
    if (budgetRatio < 0.5) {
      return `Requested budget of $${lead.budget_per_night}/night is significantly below the hotel's minimum rate of $${hotelProfile.rate_min}/night.`
    }
  }

  return null // No hard rejection — proceed to scoring
}

// =============================================
// AUTO-REJECT: generate decline email + save
// =============================================
async function autoRejectLead(lead, hotelId, hotelProfile, rejectionReason) {
  // Generate a polite decline email via secure Edge Function
  const prompt = buildRejectionPrompt(lead, rejectionReason, hotelProfile)
  let email = { subject: 'Regarding Your Group Inquiry', body: 'Thank you for your inquiry. Unfortunately we are unable to accommodate your group at this time. We wish you the best with your event.' }
  try {
    const raw = await callClaude('generate-rejection', { prompt })
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    email = JSON.parse(cleaned)
  } catch { /* use fallback */ }

  // Save to lead_decisions as auto-rejected
  const { data, error } = await supabase
    .from('lead_decisions')
    .upsert({
      lead_id: lead.id,
      hotel_id: hotelId,
      score: null,
      auto_rejected: true,
      rejection_reason: rejectionReason,
      rejection_draft_subject: email.subject,
      rejection_draft_body: email.body
    })
    .select()
    .single()

  if (error) throw error

  // Mark lead as processed so it doesn't get re-scored
  await supabase
    .from('leads')
    .update({ status: 'processed' })
    .eq('id', lead.id)

  return data
}

// =============================================
// MANUAL DECLINE — rep clicks Decline on any lead
// Generates decline email, notifies platform, archives
// =============================================
export async function declineLead(lead, hotelId) {
  const { data: profile } = await supabase
    .from('hotel_profiles')
    .select('*, hotels(name)')
    .eq('hotel_id', hotelId)
    .single()

  const hotelProfile = { ...profile, hotel_name: profile.hotels?.name }

  // Check if a decline draft already exists (auto-rejected leads have one)
  const { data: existing } = await supabase
    .from('lead_decisions')
    .select('rejection_draft_subject, rejection_draft_body')
    .eq('lead_id', lead.id)
    .single()

  let subject = existing?.rejection_draft_subject
  let body = existing?.rejection_draft_body

  // If no decline draft yet, generate one now via secure Edge Function
  if (!subject || !body) {
    const reason = 'The sales team has decided to pass on this inquiry at this time.'
    const prompt = buildRejectionPrompt(lead, reason, hotelProfile)
    try {
      const raw = await callClaude('generate-rejection', { prompt })
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const email = JSON.parse(cleaned)
      subject = email.subject
      body = email.body
    } catch { /* use defaults */ }
  }

  // Mark as declined
  await supabase
    .from('lead_decisions')
    .update({
      declined_at: new Date().toISOString(),
      rejection_draft_subject: subject,
      rejection_draft_body: body
    })
    .eq('lead_id', lead.id)

  // Log the decline email in threads
  await supabase.from('email_threads').insert({
    lead_id: lead.id,
    hotel_id: hotelId,
    direction: 'outbound',
    subject: subject,
    body: body,
    to_address: lead.contact_email
  })

  // Archive the lead
  await supabase
    .from('leads')
    .update({ status: 'archived' })
    .eq('id', lead.id)

  // Notify through the originating platform (Delphi, Cvent, etc.)
  try {
    await declineOnPlatform(lead, hotelId)
  } catch (err) {
    console.warn('Platform decline notification failed (non-critical):', err)
  }
}

// =============================================
// CLASSIFY INBOUND REPLY + DRAFT RESPONSE
// =============================================
export async function classifyReply(inboundEmail, leadId, hotelId) {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  const { data: profile } = await supabase
    .from('hotel_profiles')
    .select('*, hotels(name)')
    .eq('hotel_id', hotelId)
    .single()

  const hotelProfile = { ...profile, hotel_name: profile.hotels?.name }

  const prompt = buildReplyClassificationPrompt(inboundEmail, lead, hotelProfile)
  const systemPrompt = buildScoringSystemPrompt(hotelProfile)

  const raw = await callClaude('score-lead', { systemPrompt, userPrompt: prompt })
  let result
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    result = JSON.parse(cleaned)
  } catch {
    throw new Error(`Agent returned invalid JSON: ${raw}`)
  }

  // Store reply draft
  const { data, error } = await supabase
    .from('reply_drafts')
    .insert({
      lead_id: leadId,
      hotel_id: hotelId,
      in_reply_to: inboundEmail.id,
      reply_type: result.reply_type,
      draft_subject: result.draft_subject,
      draft_body: result.draft_body,
      status: 'pending'
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// =============================================
// GENERATE FOLLOW-UP SEQUENCE
// =============================================
async function scheduleFollowUps(lead, hotelId, hotelProfile, originalEmailBody) {
  const checkIn = lead.dates_requested?.check_in
  const baseDate = new Date()

  const sequences = [
    { day: 3, date: addDays(baseDate, 3) },
    { day: 7, date: addDays(baseDate, 7) },
    { day: 14, date: addDays(baseDate, 14) }
  ]

  for (const seq of sequences) {
    const prompt = buildFollowUpPrompt(lead, seq.day, originalEmailBody, hotelProfile)

    let raw
    try {
      raw = await callClaude('score-lead', { systemPrompt: '', userPrompt: prompt })
    } catch (err) {
      console.error('Follow-up generation failed, skipping day', seq.day, err)
      continue
    }
    let followUp
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      followUp = JSON.parse(cleaned)
    } catch {
      console.error('Could not parse follow-up JSON, skipping day', seq.day)
      continue
    }

    await supabase.from('follow_up_queue').insert({
      lead_id: lead.id,
      hotel_id: hotelId,
      sequence_day: seq.day,
      draft_subject: followUp.subject,
      draft_body: followUp.body,
      scheduled_for: seq.date.toISOString().split('T')[0],
      status: 'pending'
    })
  }
}

// =============================================
// PROCESS ALL PENDING LEADS (morning batch)
// =============================================
export async function processPendingLeads(hotelId) {
  const { data: pendingLeads, error } = await supabase
    .from('leads')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) throw error
  if (!pendingLeads?.length) return []

  const results = []
  for (const lead of pendingLeads) {
    try {
      const decision = await scoreLead(lead, hotelId)
      results.push({ leadId: lead.id, decision })
    } catch (err) {
      console.error(`Failed to score lead ${lead.id}:`, err)
    }
  }

  return results
}

// =============================================
// HELPERS
// =============================================
async function getAvailabilityContext(hotelId, datesRequested) {
  if (!datesRequested?.check_in || !datesRequested?.check_out) {
    return 'No specific dates provided by the lead.'
  }

  const { data: availability } = await supabase
    .from('availability')
    .select('*')
    .eq('hotel_id', hotelId)
    .gte('date', datesRequested.check_in)
    .lte('date', datesRequested.check_out)

  if (!availability?.length) {
    return `No availability blocks on record for ${datesRequested.check_in} to ${datesRequested.check_out}. Assume dates are open.`
  }

  const blocked = availability.filter(a => a.is_blocked)
  const low = availability.filter(a => !a.is_blocked && a.rooms_available < 50)

  if (blocked.length > 0) {
    return `WARNING: ${blocked.length} dates are fully blocked in this range. Hotel may not be able to accommodate.`
  }

  if (low.length > 0) {
    return `Availability is tight for some dates in this range (${low.length} dates with under 50 rooms). Proceed with caution.`
  }

  return `Dates ${datesRequested.check_in} to ${datesRequested.check_out} appear open with good availability.`
}

function addDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}
