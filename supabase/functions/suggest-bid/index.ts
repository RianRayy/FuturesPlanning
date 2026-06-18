// =============================================
// suggest-bid Edge Function
// Analyzes a lead + hotel profile and returns an
// AI-recommended bid rate with reasoning, win
// probability, and market context.
//
// Used by BidAdvisorModal before the hotel submits
// a proposal — helps avoid overbidding and losing
// a lead that was worth winning.
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

// Determine approximate season from dates
function getSeason(dateStr: string | null): string {
  if (!dateStr) return 'unknown season'
  const month = new Date(dateStr).getMonth() + 1
  if ([12, 1, 2].includes(month)) return 'winter (typically slower for most markets)'
  if ([3, 4, 5].includes(month)) return 'spring (peak season for corporate meetings)'
  if ([6, 7, 8].includes(month)) return 'summer (peak for social, slow for corporate)'
  return 'fall (strong corporate season)'
}

function getNightCount(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime()
  return Math.round(diff / (1000 * 60 * 60 * 24))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { hotel_id, lead_id } = await req.json()
    if (!hotel_id || !lead_id) throw new Error('hotel_id and lead_id are required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Fetch hotel profile and lead in parallel
    const [{ data: profile }, { data: lead }] = await Promise.all([
      supabase
        .from('hotel_profiles')
        .select('*, hotels(name)')
        .eq('hotel_id', hotel_id)
        .single(),
      supabase
        .from('leads')
        .select('*, lead_decisions(score, reasoning)')
        .eq('id', lead_id)
        .single()
    ])

    if (!profile || !lead) throw new Error('Hotel profile or lead not found')

    const hotelName  = profile.hotels?.name ?? 'This hotel'
    const checkIn    = lead.dates_requested?.check_in  ?? null
    const checkOut   = lead.dates_requested?.check_out ?? null
    const nights     = getNightCount(checkIn, checkOut)
    const season     = getSeason(checkIn)
    const groupSize  = lead.group_size ?? 0
    const rateMin    = profile.rate_min ?? 0
    const rateMax    = profile.rate_max ?? 0
    const leadBudget = lead.budget_per_night

    // Estimate total revenue potential for context
    const potentialRevLow  = nights && groupSize ? Math.round(nights * groupSize * rateMin) : null
    const potentialRevHigh = nights && groupSize ? Math.round(nights * groupSize * (leadBudget ?? rateMax)) : null

    // Live PMS data from whichever PMS the hotel has connected
    // (Cloudbeds or Mews) — turns the suggestion from an estimate
    // into real availability + rates. Prefers a real connection
    // over a demo fallback.
    async function callPms(fn: string) {
      try {
        const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${fn}`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'apikey':        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
          },
          body: JSON.stringify({ hotel_id, check_in: checkIn, check_out: checkOut, rooms: groupSize || null })
        })
        const data = await res.json()
        return data.connected && !data.error ? data : null
      } catch {
        return null   // PMS data is an enhancement, never a blocker
      }
    }

    let pms: any = null
    if (checkIn && checkOut) {
      const [cb, mw] = await Promise.all([callPms('cloudbeds-data'), callPms('mews-data')])
      // Prefer a real (non-demo) connection; fall back to any connected source
      pms = [cb, mw].find(p => p && p.demo !== true) ?? [cb, mw].find(Boolean) ?? null
    }

    const pmsBlock = pms ? `
LIVE PMS DATA (Cloudbeds — real availability and public rates for these exact dates):
- Rooms actually available: ${pms.total_rooms_available}
- Can fit this group of ${groupSize}: ${pms.can_fit_group === null ? 'unknown' : pms.can_fit_group ? 'YES' : 'NO — availability is tight, price accordingly or flag the constraint'}
- Current public rates for these dates: ${pms.rate_low && pms.rate_high ? `$${pms.rate_low} – $${pms.rate_high}/night` : 'not returned'}
- Room types: ${pms.room_types?.slice(0, 6).map((rt: any) => `${rt.name} (${rt.available} avail${rt.rate ? `, $${rt.rate}` : ''})`).join('; ') ?? 'n/a'}
Weight this heavily: group rates typically run 10-25% below public rates. If availability is tight, discount less.` : ''

    const prompt = `You are a hotel revenue management expert helping ${hotelName} determine the optimal group rate to bid on an RFP. Your goal is to maximize win probability WITHOUT leaving money on the table.

HOTEL:
- Property: ${hotelName}
- Room count: ${profile.room_count ?? 'unknown'}
- Standard rate range: $${rateMin} – $${rateMax}/night
- Minimum group size: ${profile.min_group_size ?? 'none'}
- F&B minimum: ${profile.fb_minimum ? '$' + profile.fb_minimum : 'none set'}
- Hotel description: ${profile.hotel_description ?? 'not provided'}

RFP DETAILS:
- Company/Organization: ${lead.company ?? 'not specified'}
- Event type: ${lead.event_type ?? 'not specified'}
- Group size: ${groupSize} rooms
- Dates: ${checkIn ?? 'not specified'} to ${checkOut ?? 'not specified'} (${nights ? nights + ' nights' : 'duration unknown'})
- Season context: ${season}
- Planner's stated budget: ${leadBudget ? '$' + leadBudget + '/night' : 'not disclosed'}
- F&B budget: ${lead.fb_budget ? '$' + lead.fb_budget : 'not specified'}
- Special requests: ${lead.special_requests ?? 'none'}
- Agent score: ${lead.lead_decisions?.score ?? 'unknown'}
- Agent reasoning: ${lead.lead_decisions?.reasoning ?? 'not available'}
${potentialRevLow && potentialRevHigh ? `- Total revenue potential: $${potentialRevLow.toLocaleString()} – $${potentialRevHigh.toLocaleString()}` : ''}
${pmsBlock}
BIDDING GUIDELINES:
- Never bid below the hotel's rate minimum ($${rateMin}/night) unless there is a strong strategic reason
- If the planner disclosed their budget, bid 5-12% below it to be clearly competitive while preserving margin
- For large groups (50+ rooms), a meaningful discount signals flexibility — don't bid at rack rate
- For corporate events, planners are often on a fixed budget and will pick the best value, not lowest price
- For social/wedding events, value signals (amenities, service) matter more than just price
- If the budget wasn't disclosed, recommend the midpoint of the hotel's range adjusted for group size

Respond ONLY with valid JSON, no markdown:
{
  "suggested_rate": <number, dollars per night, no decimals>,
  "rate_range": { "low": <number>, "high": <number> },
  "win_probability": "high" | "medium" | "low",
  "probability_note": "<one sentence on what drives this probability>",
  "reasoning": "<2-3 sentences explaining the suggested rate to the sales manager>",
  "market_context": "<1-2 sentences on market positioning and competitive landscape for this type of group>",
  "factors": [
    { "label": "<factor name>", "impact": "positive" | "negative" | "neutral", "note": "<one sentence>" }
  ]
}`

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 700,
        messages:   [{ role: 'user', content: prompt }]
      })
    })

    if (!claudeRes.ok) throw new Error(`Claude API error: ${claudeRes.status}`)

    const claudeData = await claudeRes.json()
    const raw        = claudeData.content[0].text
    const cleaned    = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const suggestion = JSON.parse(cleaned)

    // Enforce hard floor — never suggest below hotel's rate minimum
    if (suggestion.suggested_rate < rateMin) {
      suggestion.suggested_rate = rateMin
      suggestion.rate_range.low = rateMin
    }

    return new Response(
      JSON.stringify({
        ...suggestion,
        lead_budget: leadBudget,
        rate_min: rateMin,
        rate_max: rateMax,
        live_availability: pms ? {
          total_rooms_available: pms.total_rooms_available,
          can_fit_group:         pms.can_fit_group,
          public_rate_low:       pms.rate_low,
          public_rate_high:      pms.rate_high
        } : null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('suggest-bid error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
