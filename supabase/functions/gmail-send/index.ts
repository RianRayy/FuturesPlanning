import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// Encode a UTF-8 string as base64url (required by Gmail API)
function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Build a multipart email: plain-text part + HTML part with an
// invisible tracking pixel so we know when the planner opens it,
// plus a link to the branded proposal page
export function buildEmail(to: string, subject: string, body: string, leadId: string | null): string {
  const boundary = 'fp_' + crypto.randomUUID().replace(/-/g, '')
  const pixelUrl = leadId
    ? `${Deno.env.get('SUPABASE_URL')}/functions/v1/track-open?lid=${leadId}`
    : null
  const proposalUrl = leadId
    ? `${Deno.env.get('APP_URL')}/p/${leadId}`
    : null

  const textBody = proposalUrl
    ? `${body}\n\n—\nView your full proposal online: ${proposalUrl}`
    : body

  const htmlBody =
    `<div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#222;white-space:pre-wrap;">` +
    escapeHtml(body) +
    `</div>` +
    (proposalUrl
      ? `<div style="margin-top:24px;"><a href="${proposalUrl}" style="display:inline-block;background:#4f7ef8;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;font-weight:600;">View Your Full Proposal</a></div>`
      : '') +
    (pixelUrl ? `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;">` : '')

  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
    '',
    `--${boundary}--`
  ].join('\r\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { lead_id, hotel_id, to, subject, body, bid_rate, bid_notes } = await req.json()

    if (!to || !subject || !body) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, subject, body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Fetch stored Gmail OAuth tokens
    const { data: conn } = await supabase
      .from('crm_connections')
      .select('config')
      .eq('hotel_id', hotel_id)
      .eq('provider', 'gmail')
      .single()

    if (!conn?.config?.access_token) {
      return new Response(
        JSON.stringify({ error: 'Gmail not connected. Go to Settings → Connections and connect Gmail first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let accessToken = conn.config.access_token

    // 2. Refresh the access token (they expire after 1 hour)
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
        // Persist the fresh token
        await supabase
          .from('crm_connections')
          .update({ config: { ...conn.config, access_token: accessToken } })
          .eq('hotel_id', hotel_id)
          .eq('provider', 'gmail')
      }
    }

    // 3. Build RFC 2822 multipart email with open-tracking pixel
    const message = buildEmail(to, subject, body, lead_id ?? null)
    const encoded = toBase64Url(message)

    // 4. Send via Gmail API
    const sendRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: encoded })
      }
    )

    if (!sendRes.ok) {
      const errText = await sendRes.text()
      console.error('Gmail API error:', errText)
      throw new Error(`Gmail API error: ${sendRes.status}`)
    }

    const gmailResult = await sendRes.json()

    // 5. Mark lead as sent in the database
    if (lead_id) {
      await supabase
        .from('lead_decisions')
        .update({
          approved_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          bid_rate: bid_rate ?? null
        })
        .eq('lead_id', lead_id)

      // Log in email_threads for the full audit trail
      await supabase.from('email_threads').insert({
        lead_id,
        hotel_id,
        direction: 'outbound',
        subject,
        body,
        to_address: to
      })

      // 6. If this is a Cvent lead, also submit the proposal back to Cvent
      // so the meeting planner sees the response in their Cvent dashboard
      const { data: lead } = await supabase
        .from('leads')
        .select('source, external_id, budget_per_night')
        .eq('id', lead_id)
        .single()

      if (lead?.source === 'cvent' && lead?.external_id) {
        try {
          await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/cvent-submit-proposal`,
            {
              method: 'POST',
              headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'apikey':        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
              },
              body: JSON.stringify({
                hotel_id,
                rfp_id:     lead.external_id,
                rate:       bid_rate ?? lead.budget_per_night,
                email_body: body,
                notes:      bid_notes ?? null
              })
            }
          )
        } catch (cventErr) {
          // Non-critical — email already sent, just log
          console.warn('Cvent proposal submit failed (non-critical):', cventErr)
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, messageId: gmailResult.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('gmail-send error:', err)
    return new Response(
      JSON.stringify({ error: err.message ?? 'Failed to send email' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
