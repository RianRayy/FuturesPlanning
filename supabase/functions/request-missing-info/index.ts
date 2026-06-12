// =============================================
// request-missing-info Edge Function
// Finds leads that arrived with critical fields
// missing (dates, group size) and automatically
// emails the planner a short, friendly ask in the
// hotel's tone. Runs after every ingest pass.
//
// Guard rails:
//   - Only asks once per lead (info_requested_at)
//   - Skips leads already responded to (sent_at)
//   - Needs a valid contact email to ask
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getGmailToken, sendGmail, callClaude } from '../_shared/gmail.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getMissingFields(lead: any): string[] {
  const missing: string[] = []
  if (!lead.dates_requested?.check_in) missing.push('preferred event/check-in dates')
  if (!lead.group_size)                missing.push('approximate number of rooms or guests')
  if (!lead.event_type)                missing.push('type of event')
  return missing
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { hotel_id } = await req.json()
    if (!hotel_id) throw new Error('hotel_id is required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Leads with a contact email, not yet responded to, never asked before
    const { data: leads } = await supabase
      .from('leads')
      .select('*, lead_decisions(sent_at, info_requested_at)')
      .eq('hotel_id', hotel_id)
      .in('status', ['pending', 'processed'])
      .not('contact_email', 'is', null)

    if (!leads?.length) {
      return new Response(
        JSON.stringify({ success: true, asked: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const candidates = leads.filter(l =>
      EMAIL_RE.test(l.contact_email) &&
      !l.lead_decisions?.sent_at &&
      !l.lead_decisions?.info_requested_at &&
      getMissingFields(l).length > 0
    )

    if (!candidates.length) {
      return new Response(
        JSON.stringify({ success: true, asked: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Hotel profile for tone + Gmail token (once per run)
    const [{ data: profile }, accessToken] = await Promise.all([
      supabase.from('hotel_profiles').select('*, hotels(name)').eq('hotel_id', hotel_id).single(),
      getGmailToken(supabase, hotel_id)
    ])

    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'Gmail not connected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const hotelName = profile?.hotels?.name ?? 'our hotel'
    let asked = 0

    for (const lead of candidates) {
      const missing = getMissingFields(lead)

      let draft
      try {
        draft = await callClaude(`You are responding on behalf of ${hotelName} to a new group inquiry that is missing key details. Write a SHORT, warm email asking for them.

INQUIRY:
- From: ${lead.contact_name ?? 'a planner'}${lead.company ? ` (${lead.company})` : ''}
- What we know: ${[
          lead.event_type && `event type: ${lead.event_type}`,
          lead.group_size && `${lead.group_size} rooms`,
          lead.dates_requested?.check_in && `dates: ${lead.dates_requested.check_in}`,
          lead.budget_per_night && `budget: $${lead.budget_per_night}/night`
        ].filter(Boolean).join(', ') || 'very little — just their contact info'}
- Original message: ${(lead.raw_content ?? '').slice(0, 800)}

MISSING (ask for these naturally, not as a checklist): ${missing.join('; ')}

Hotel tone: ${profile?.personal_tone_summary ?? 'professional and warm'}

Rules:
- 3-5 sentences max
- Thank them for reaching out, express genuine interest
- Ask for the missing details conversationally
- Do not quote rates or commit to availability
- Sign off from the ${hotelName} team

Respond ONLY with valid JSON, no markdown:
{ "subject": "<subject line>", "body": "<email body>" }`)
      } catch (err) {
        console.error(`Draft failed for lead ${lead.id}:`, err)
        continue
      }

      try {
        await sendGmail(accessToken, lead.contact_email, draft.subject, draft.body, lead.id)
      } catch (err) {
        console.error(`Send failed for lead ${lead.id}:`, err)
        continue
      }

      // Log the thread + mark asked (upsert in case no decision row exists yet)
      await supabase.from('email_threads').insert({
        lead_id:    lead.id,
        hotel_id,
        direction:  'outbound',
        subject:    draft.subject,
        body:       draft.body,
        to_address: lead.contact_email
      })

      await supabase
        .from('lead_decisions')
        .upsert(
          { lead_id: lead.id, hotel_id, info_requested_at: new Date().toISOString() },
          { onConflict: 'lead_id' }
        )

      asked++
    }

    return new Response(
      JSON.stringify({ success: true, asked }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('request-missing-info error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
