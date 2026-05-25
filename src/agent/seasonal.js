import { supabase } from '../supabase'

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function callClaude(prompt) {
  const res = await fetch(`${FUNCTIONS_URL}/generate-seasonal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY
    },
    body: JSON.stringify({ prompt })
  })
  if (!res.ok) throw new Error(`generate-seasonal failed: ${await res.text()}`)
  const data = await res.json()
  return data.text
}

// =============================================
// SEGMENT REPEAT LIKELIHOOD
// How likely is this segment to recur annually
// =============================================
const SEGMENT_REPEAT_SCORE = {
  corporate:    0.90,  // Annual meetings, offsites, SKOs — almost always repeat
  sports:       0.85,  // Tournaments follow season calendars
  government:   0.75,  // Budget-based, annual procurement cycles
  religious:    0.72,  // Annual conventions, retreats
  'tour & travel': 0.70,
  social:       0.55,  // Reunions are every 2-3 years
  wedding:      0.08,  // One-time unless honeymoon
  other:        0.50
}

// =============================================
// OUTCOME MULTIPLIERS
// Did they book, lose to competitor, or get declined?
// =============================================
const OUTCOME_MULTIPLIER = {
  booked:               1.0,  // Came before, loved it — easiest win
  no_response:          0.85, // Never replied — worth another shot
  lost_to_competitor:   0.80, // They were shopping — draft a better offer
  declined_by_hotel:    0.65, // We said no — but circumstances may have changed
  pending:              0.75
}

// =============================================
// SCORE A SINGLE LEAD FOR REPEAT POTENTIAL
// Returns a 0-1 score and reasoning signals
// =============================================
export function scoreRepeatPotential(lead, hotelProfile) {
  const signals = []
  let score = 0.5 // baseline

  // 1. Segment repeat likelihood
  const segment = lead.event_type?.toLowerCase() ?? 'other'
  const segmentScore = SEGMENT_REPEAT_SCORE[segment] ?? 0.5
  score = score * 0.3 + segmentScore * 0.7
  signals.push({
    factor: 'Segment',
    value: lead.event_type,
    impact: segmentScore >= 0.8 ? 'high' : segmentScore >= 0.6 ? 'medium' : 'low',
    note: segmentScore >= 0.8
      ? `${lead.event_type} groups almost always repeat annually`
      : segmentScore >= 0.6
      ? `${lead.event_type} groups often return`
      : `${lead.event_type} groups rarely repeat`
  })

  // Skip weddings entirely (unless we add honeymoon flag later)
  if (segment === 'wedding') {
    return { score: 0, label: 'low', signals, skip: true, skipReason: 'Wedding — one-time event' }
  }

  // 2. Outcome multiplier
  const outcome = lead.outcome ?? 'pending'
  const outcomeMultiplier = OUTCOME_MULTIPLIER[outcome] ?? 0.75
  score *= outcomeMultiplier
  if (outcome === 'booked') {
    signals.push({ factor: 'History', value: 'Previously booked', impact: 'high', note: 'Booked with you before — highest conversion probability' })
  } else if (outcome === 'lost_to_competitor') {
    signals.push({ factor: 'History', value: 'Lost to competitor', impact: 'medium', note: 'They chose a competitor — worth a targeted offer' })
  } else if (outcome === 'no_response') {
    signals.push({ factor: 'History', value: 'No response', impact: 'medium', note: 'Never replied — timing may be better this year' })
  } else if (outcome === 'declined_by_hotel') {
    signals.push({ factor: 'History', value: 'Previously declined', impact: 'low', note: 'Hotel declined — check if fit has improved' })
  }

  // 3. Group size (larger = more revenue = higher priority)
  const groupSize = lead.group_size ?? 0
  if (groupSize >= 100) {
    score = Math.min(1, score + 0.12)
    signals.push({ factor: 'Group Size', value: `${groupSize} rooms`, impact: 'high', note: 'Large group — significant revenue opportunity' })
  } else if (groupSize >= 50) {
    score = Math.min(1, score + 0.06)
    signals.push({ factor: 'Group Size', value: `${groupSize} rooms`, impact: 'medium', note: 'Mid-size group' })
  } else if (groupSize < 15) {
    score = Math.max(0, score - 0.08)
    signals.push({ factor: 'Group Size', value: `${groupSize} rooms`, impact: 'low', note: 'Small group — lower revenue priority' })
  }

  // 4. Budget vs hotel minimum
  if (lead.budget_per_night && hotelProfile?.rate_min) {
    const budgetRatio = lead.budget_per_night / hotelProfile.rate_min
    if (budgetRatio >= 1.2) {
      score = Math.min(1, score + 0.08)
      signals.push({ factor: 'Budget', value: `$${lead.budget_per_night}/night`, impact: 'high', note: 'Budget above minimum — strong fit' })
    } else if (budgetRatio < 0.9) {
      score = Math.max(0, score - 0.10)
      signals.push({ factor: 'Budget', value: `$${lead.budget_per_night}/night`, impact: 'low', note: 'Budget below minimum — may need negotiation' })
    }
  }

  // 5. Has company name = more likely a recurring org
  if (lead.company) {
    score = Math.min(1, score + 0.05)
    signals.push({ factor: 'Organization', value: lead.company, impact: 'medium', note: 'Named organization — more likely to have annual events' })
  }

  // Final label
  const label = score >= 0.72 ? 'high' : score >= 0.50 ? 'medium' : 'low'

  return { score: Math.round(score * 100) / 100, label, signals, skip: false }
}

// =============================================
// CHECK IF A LEAD IS IN ITS SEASONAL WINDOW
// Returns true if we're within 75 days before
// the anniversary of their original inquiry
// =============================================
function isInSeasonalWindow(lead) {
  const checkIn = lead.dates_requested?.check_in
  if (!checkIn) return false

  const originalDate = new Date(checkIn)
  const today = new Date()

  // Build the anniversary date for this year (or next year if passed)
  let anniversary = new Date(
    today.getFullYear(),
    originalDate.getMonth(),
    originalDate.getDate()
  )

  // If the anniversary already passed this year, use next year
  if (anniversary < today) {
    anniversary.setFullYear(today.getFullYear() + 1)
  }

  const daysUntilAnniversary = Math.ceil((anniversary - today) / (1000 * 60 * 60 * 24))

  // Flag if we're 10-75 days before their booking anniversary
  return daysUntilAnniversary >= 10 && daysUntilAnniversary <= 75
}

// =============================================
// GENERATE OUTREACH EMAIL VIA CLAUDE
// =============================================
async function generateOutreachEmail(lead, scoreData, hotelProfile) {
  const outcomeContext = {
    booked: 'They successfully booked and stayed with us previously.',
    lost_to_competitor: 'They inquired but chose a competitor last time.',
    no_response: 'They inquired last year but never responded.',
    declined_by_hotel: 'We were unable to accommodate them last time but would like to reconnect.',
    pending: 'They inquired with us previously.'
  }

  const prompt = `You are a hotel sales agent for ${hotelProfile.hotel_name}.

Write a short, personalized re-engagement email to a past lead approaching their likely booking season.

LEAD HISTORY:
- Contact: ${lead.contact_name}${lead.company ? ` at ${lead.company}` : ''}
- Event type: ${lead.event_type}
- Last year's details: ${lead.group_size} rooms, around ${lead.dates_requested?.check_in ?? 'similar dates'}
- Budget: ${lead.budget_per_night ? `$${lead.budget_per_night}/night` : 'not specified'}
- What happened: ${outcomeContext[lead.outcome ?? 'pending']}

WHY WE'RE REACHING OUT:
${scoreData.signals.map(s => `- ${s.note}`).join('\n')}

HOTEL: ${hotelProfile.hotel_name}
TONE: ${hotelProfile.tone_of_voice}

INSTRUCTIONS:
- Reference their specific event type and approximate group size naturally
- If they booked before, thank them and express excitement to host again
- If they chose a competitor, be gracious and mention you'd love the opportunity
- If they never responded, keep it light and low-pressure
- Include a clear call to action (reply, call, or quick chat)
- Keep it under 150 words — short emails get read
- Do NOT mention competitor names

Respond with JSON:
{
  "subject": "email subject line",
  "body": "full email body"
}`

  const raw = await callClaude(prompt)
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  return JSON.parse(cleaned)
}

// =============================================
// MAIN: RUN SEASONAL ANALYSIS FOR A HOTEL
// Finds all past leads in their booking window,
// scores them, and generates outreach drafts
// =============================================
export async function runSeasonalAnalysis(hotelId) {
  // 1. Get hotel profile
  const { data: profile } = await supabase
    .from('hotel_profiles')
    .select('*, hotels(name)')
    .eq('hotel_id', hotelId)
    .single()

  if (!profile) throw new Error('Hotel profile not found')

  const hotelProfile = { ...profile, hotel_name: profile.hotels?.name }

  // 2. Get all past leads (processed, from any time)
  const { data: allLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('status', 'processed')
    .eq('repeat_eligible', true)

  if (!allLeads?.length) return []

  // 3. Check which leads already have seasonal outreach this year
  const currentYear = new Date().getFullYear()
  const { data: existing } = await supabase
    .from('seasonal_outreach')
    .select('lead_id')
    .eq('hotel_id', hotelId)
    .eq('season_year', currentYear)

  const alreadyQueued = new Set(existing?.map(e => e.lead_id) ?? [])

  // 4. Filter to leads in their seasonal window & not already queued
  const windowLeads = allLeads.filter(lead =>
    !alreadyQueued.has(lead.id) && isInSeasonalWindow(lead)
  )

  if (!windowLeads.length) return []

  // 5. Score each lead
  const scored = windowLeads
    .map(lead => ({ lead, scoreData: scoreRepeatPotential(lead, hotelProfile) }))
    .filter(({ scoreData }) => !scoreData.skip && scoreData.score >= 0.35)
    .sort((a, b) => b.scoreData.score - a.scoreData.score)

  // 6. Generate outreach emails and save to DB
  const results = []
  for (const { lead, scoreData } of scored) {
    try {
      const email = await generateOutreachEmail(lead, scoreData, hotelProfile)

      const checkIn = new Date(lead.dates_requested?.check_in)
      const today = new Date()
      let windowStart = new Date(today.getFullYear(), checkIn.getMonth(), checkIn.getDate())
      if (windowStart < today) windowStart.setFullYear(today.getFullYear() + 1)
      windowStart.setDate(windowStart.getDate() - 75)
      const windowEnd = new Date(windowStart)
      windowEnd.setDate(windowEnd.getDate() + 65)

      const { data } = await supabase
        .from('seasonal_outreach')
        .insert({
          hotel_id: hotelId,
          lead_id: lead.id,
          season_year: currentYear,
          potential_score: scoreData.score,
          score_label: scoreData.label,
          reasoning: scoreData.signals.map(s => s.note).join(' • '),
          repeat_signals: scoreData.signals,
          draft_subject: email.subject,
          draft_body: email.body,
          outreach_window_start: windowStart.toISOString().split('T')[0],
          outreach_window_end: windowEnd.toISOString().split('T')[0],
          status: 'pending'
        })
        .select()
        .single()

      if (data) results.push(data)
    } catch (err) {
      console.error(`Failed seasonal outreach for lead ${lead.id}:`, err)
    }
  }

  return results
}
