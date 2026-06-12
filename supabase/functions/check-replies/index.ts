// =============================================
// check-replies Edge Function
// Scans the hotel's Gmail for replies from lead
// contacts. For each new reply:
//   1. Logs it as an inbound email_threads row
//   2. If the lead was missing info, extracts any
//      details the planner provided and merges them
//      into the lead, then re-queues it for scoring
//   3. If a proposal was already sent, generates a
//      reply draft for the Replies section
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getGmailToken, extractEmailBody, getHeader, callClaude } from '../_shared/gmail.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
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

    const accessToken = await getGmailToken(supabase, hotel_id)
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'Gmail not connected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Leads we've emailed (proposal or info request) — those contacts may reply
    const { data: leads } = await supabase
      .from('leads')
      .select('*, lead_decisions(sent_at, info_requested_at, draft_subject)')
      .eq('hotel_id', hotel_id)
      .not('contact_email', 'is', null)
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
      .limit(40)

    const awaiting = (leads ?? []).filter(l =>
      l.lead_decisions?.sent_at || l.lead_decisions?.info_requested_at
    )

    if (!awaiting.length) {
      return new Response(
        JSON.stringify({ success: true, replies: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // One Gmail search for all contacts at once
    const fromQuery = [...new Set(awaiting.map(l => l.contact_email))]
      .slice(0, 20)
      .map(e => `from:${e}`)
      .join(' OR ')

    const searchRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(`(${fromQuery}) newer_than:14d`)}&maxResults=30`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!searchRes.ok) throw new Error(`Gmail search failed: ${searchRes.status}`)
    const { messages = [] } = await searchRes.json()

    if (!messages.length) {
      return new Response(
        JSON.stringify({ success: true, replies: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Skip messages we've already processed
    const { data: existing } = await supabase
      .from('email_threads')
      .select('gmail_message_id')
      .eq('hotel_id', hotel_id)
      .not('gmail_message_id', 'is', null)
    const seen = new Set(existing?.map(t => t.gmail_message_id) ?? [])

    // Hotel profile for reply drafting tone
    const { data: profile } = await supabase
      .from('hotel_profiles')
      .select('*, hotels(name)')
      .eq('hotel_id', hotel_id)
      .single()
    const hotelName = profile?.hotels?.name ?? 'our hotel'

    let processed = 0

    for (const msg of messages) {
      if (seen.has(msg.id)) continue

      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!msgRes.ok) continue
      const msgData = await msgRes.json()

      const headers  = msgData.payload?.headers ?? []
      const fromRaw  = getHeader(headers, 'From')
      const subject  = getHeader(headers, 'Subject')
      const body     = extractEmailBody(msgData.payload)
      if (!body) continue

      // Match the sender back to a lead
      const fromEmail = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw).toLowerCase().trim()
      const lead = awaiting.find(l => l.contact_email?.toLowerCase() === fromEmail)
      if (!lead) continue

      // 1. Log inbound thread
      const { data: thread } = await supabase
        .from('email_threads')
        .insert({
          lead_id:          lead.id,
          hotel_id,
          direction:        'inbound',
          subject,
          body:             body.slice(0, 8000),
          from_address:     fromEmail,
          gmail_message_id: msg.id
        })
        .select('id')
        .single()

      const wasInfoRequest = lead.lead_decisions?.info_requested_at && !lead.lead_decisions?.sent_at

      if (wasInfoRequest) {
        // 2. Merge any details the planner provided into the lead
        try {
          const extracted = await callClaude(`A group event planner replied to our request for more details. Extract any concrete details from their reply.

Their reply:
${body.slice(0, 2500)}

Current lead data (only fill gaps, return null for anything not mentioned in the reply):
- group_size: ${lead.group_size ?? 'unknown'}
- check_in: ${lead.dates_requested?.check_in ?? 'unknown'}
- check_out: ${lead.dates_requested?.check_out ?? 'unknown'}
- event_type: ${lead.event_type ?? 'unknown'}
- budget_per_night: ${lead.budget_per_night ?? 'unknown'}

Respond ONLY with valid JSON, no markdown:
{
  "group_size": <integer or null>,
  "check_in": "<YYYY-MM-DD or null>",
  "check_out": "<YYYY-MM-DD or null>",
  "event_type": "<string or null>",
  "budget_per_night": <number or null>,
  "special_requests": "<string or null>"
}`)

          const updates: Record<string, unknown> = {}
          if (extracted.group_size && !lead.group_size) updates.group_size = extracted.group_size
          if (extracted.event_type && !lead.event_type) updates.event_type = extracted.event_type
          if (extracted.budget_per_night && !lead.budget_per_night) updates.budget_per_night = extracted.budget_per_night
          if (extracted.special_requests) updates.special_requests = [lead.special_requests, extracted.special_requests].filter(Boolean).join(' | ')
          if (extracted.check_in || extracted.check_out) {
            updates.dates_requested = {
              ...lead.dates_requested,
              check_in:  extracted.check_in  ?? lead.dates_requested?.check_in ?? null,
              check_out: extracted.check_out ?? lead.dates_requested?.check_out ?? null
            }
          }

          if (Object.keys(updates).length > 0) {
            // Re-queue for scoring now that we know more
            updates.status = 'pending'
            await supabase.from('leads').update(updates).eq('id', lead.id)
          }
        } catch (err) {
          console.error(`Info extraction failed for lead ${lead.id}:`, err)
        }
      } else {
        // 3. Proposal was already sent — draft a reply for the hotel to approve
        try {
          const draft = await callClaude(`A planner replied to our group sales proposal from ${hotelName}. Classify their reply and draft a response in the hotel's tone.

Planner: ${lead.contact_name}${lead.company ? ` (${lead.company})` : ''}
Original proposal subject: ${lead.lead_decisions?.draft_subject ?? 'our proposal'}
Their reply:
${body.slice(0, 2500)}

Hotel tone: ${profile?.personal_tone_summary ?? 'professional and warm'}

Respond ONLY with valid JSON, no markdown:
{
  "reply_type": "pricing_question" | "site_visit" | "alternate_dates" | "decline" | "general",
  "draft_subject": "Re: <their subject>",
  "draft_body": "<full response email, warm and helpful, no rate commitments beyond what was already proposed>"
}`)

          await supabase.from('reply_drafts').insert({
            lead_id:       lead.id,
            hotel_id,
            in_reply_to:   thread?.id ?? null,
            reply_type:    draft.reply_type,
            draft_subject: draft.draft_subject,
            draft_body:    draft.draft_body
          })
        } catch (err) {
          console.error(`Reply draft failed for lead ${lead.id}:`, err)
        }
      }

      processed++
    }

    return new Response(
      JSON.stringify({ success: true, replies: processed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('check-replies error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
