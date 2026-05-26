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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { lead_id, hotel_id, to, subject, body } = await req.json()

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

    // 3. Build RFC 2822 email message
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ].join('\r\n')

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
          sent_at: new Date().toISOString()
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
