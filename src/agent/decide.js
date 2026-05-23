import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../supabase'
import {
  buildScoringSystemPrompt,
  buildScoringPrompt,
  buildReplyClassificationPrompt,
  buildFollowUpPrompt
} from './prompts'

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  dangerouslyAllowBrowser: true
})

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

  // 2. Check availability for requested dates
  const availabilityContext = await getAvailabilityContext(
    hotelId,
    lead.dates_requested
  )

  // 3. Call Claude
  const systemPrompt = buildScoringSystemPrompt(hotelProfile)
  const userPrompt = buildScoringPrompt(lead, availabilityContext)

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  })

  // 4. Parse response
  const raw = message.content[0].text
  let decision
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    decision = JSON.parse(cleaned)
  } catch {
    throw new Error(`Agent returned invalid JSON: ${raw}`)
  }

  // 5. Store decision in Supabase
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

  // 6. Mark lead as processed
  await supabase
    .from('leads')
    .update({ status: 'processed' })
    .eq('id', lead.id)

  // 7. Generate follow-up sequence (Day 3, 7, 14)
  if (decision.score !== 'cold') {
    await scheduleFollowUps(lead, hotelId, hotelProfile, decision.draft_body)
  }

  return data
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

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: buildScoringSystemPrompt(hotelProfile),
    messages: [{ role: 'user', content: prompt }]
  })

  const raw = message.content[0].text
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

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    })

    const raw = message.content[0].text
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
