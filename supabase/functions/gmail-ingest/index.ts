// =============================================
// gmail-ingest Edge Function
// Scans a hotel's Gmail inbox for lead notification
// emails from Cvent, HotelPlanner, Delphi, and any
// other platform that emails the hotel when a new
// RFP or group inquiry arrives.
//
// Uses Claude to intelligently parse email content
// into structured lead data — no API access needed
// from any platform.
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

// Known lead notification senders — we search Gmail for emails from these domains/addresses
const LEAD_SENDERS = [
  'cvent.com',
  'hotelplanner.com',
  'delphi.com',
  'amadeus-hospitality.com',
  'eventbrite.com',
  'meetings.com',
  'helms-briscoe.com',  // Large hotel booking agency
  'expedia.com',
  'booking.com',
  'groups360.com',
  'rfpio.com',
].map(d => `from:${d}`).join(' OR ')

// Subject line keywords that indicate a group/RFP lead
const LEAD_SUBJECTS = [
  'RFP',
  'group inquiry',
  'group lead',
  'meeting request',
  'event inquiry',
  'proposal request',
  'room block',
  'group booking',
  'SMERF',
  'MICE',
].map(s => `subject:"${s}"`).join(' OR ')

const GMAIL_SEARCH = `(${LEAD_SENDERS}) newer_than:14d`

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(base64)
  return decoded
}

function extractEmailBody(payload: any): string {
  // Try to get plain text first, then HTML
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data)
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        // Strip HTML tags for Claude
        return decodeBase64Url(part.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      }
      // Handle nested parts
      if (part.parts) {
        const nested = extractEmailBody(part)
        if (nested) return nested
      }
    }
  }
  return ''
}

function getHeader(headers: any[], name: string): string {
  return headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

async function parseLeadWithClaude(emailBody: string, subject: string, from: string): Promise<any | null> {
  const prompt = `You are analyzing a hotel group sales lead notification email. Extract the lead information and return it as JSON.

Email From: ${from}
Email Subject: ${subject}
Email Body:
${emailBody.slice(0, 3000)}

Extract the following fields if present. Return null for any field not found.
Respond ONLY with valid JSON, no markdown:
{
  "contact_name": "<full name of the group/event planner>",
  "contact_email": "<planner's email address>",
  "contact_phone": "<planner's phone number>",
  "company": "<company or organization name>",
  "event_type": "<type of event: corporate meeting, wedding, conference, social, etc.>",
  "group_size": <number of rooms needed, integer only>,
  "check_in": "<check-in date in YYYY-MM-DD format>",
  "check_out": "<check-out date in YYYY-MM-DD format>",
  "budget_per_night": <budget per room per night as a number, null if not specified>,
  "special_requests": "<any special requirements or notes>",
  "source_platform": "<which platform sent this email: cvent, hotelplanner, delphi, direct, etc.>",
  "is_lead": <true if this is genuinely a group/event lead, false if it's a newsletter/marketing/system email>
}`

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) throw new Error(`Claude error: ${res.status}`)
  const data = await res.json()
  const raw = data.content[0].text
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  return JSON.parse(cleaned)
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

    // 1. Get Gmail connection + tokens
    const { data: conn } = await supabase
      .from('crm_connections')
      .select('config')
      .eq('hotel_id', hotel_id)
      .eq('provider', 'gmail')
      .single()

    if (!conn?.config?.access_token) {
      return new Response(
        JSON.stringify({ error: 'Gmail not connected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Refresh access token
    let accessToken = conn.config.access_token
    if (conn.config.refresh_token) {
      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     Deno.env.get('GMAIL_CLIENT_ID')!,
          client_secret: Deno.env.get('GMAIL_CLIENT_SECRET')!,
          refresh_token: conn.config.refresh_token,
          grant_type:    'refresh_token'
        })
      })
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json()
        accessToken = refreshData.access_token
        await supabase
          .from('crm_connections')
          .update({ config: { ...conn.config, access_token: accessToken } })
          .eq('hotel_id', hotel_id)
          .eq('provider', 'gmail')
      }
    }

    // 3. Search Gmail for lead emails
    const searchRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(GMAIL_SEARCH)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!searchRes.ok) throw new Error(`Gmail search failed: ${searchRes.status}`)
    const searchData = await searchRes.json()
    const messages = searchData.messages ?? []

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, found: 0, imported: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Get already-processed message IDs to avoid duplicates
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('external_id')
      .eq('hotel_id', hotel_id)
      .eq('source', 'email')

    const processedIds = new Set(existingLeads?.map(l => l.external_id) ?? [])

    let imported = 0

    // 5. Process each email
    for (const msg of messages) {
      if (processedIds.has(msg.id)) continue

      // Fetch full email
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!msgRes.ok) continue
      const msgData = await msgRes.json()

      const headers = msgData.payload?.headers ?? []
      const subject = getHeader(headers, 'Subject')
      const from    = getHeader(headers, 'From')
      const body    = extractEmailBody(msgData.payload)

      if (!body || body.length < 50) continue

      // 6. Parse with Claude
      let parsed
      try {
        parsed = await parseLeadWithClaude(body, subject, from)
      } catch {
        continue
      }

      if (!parsed?.is_lead || !parsed?.contact_name) continue

      // 7. Insert lead into database
      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert({
          hotel_id,
          source:       parsed.source_platform ?? 'email',
          external_id:  msg.id,
          contact_name: parsed.contact_name,
          contact_email: parsed.contact_email ?? null,
          contact_phone: parsed.contact_phone ?? null,
          company:      parsed.company ?? null,
          event_type:   parsed.event_type ?? null,
          group_size:   parsed.group_size ?? null,
          dates_requested: {
            check_in:  parsed.check_in ?? null,
            check_out: parsed.check_out ?? null,
            flexible:  false
          },
          budget_per_night: parsed.budget_per_night ?? null,
          special_requests: parsed.special_requests ?? null,
          raw_content:  body.slice(0, 5000),
          status:       'pending'
        })
        .select('id')
        .single()

      if (leadError || !newLead) continue

      imported++
    }

    return new Response(
      JSON.stringify({ success: true, found: messages.length, imported }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('gmail-ingest error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
