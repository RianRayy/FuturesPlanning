// =============================================
// Shared Gmail helpers for Edge Functions
// Token refresh + multipart HTML send with the
// open-tracking pixel baked in.
// =============================================

export function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Refresh + persist the hotel's Gmail access token.
// Returns null if the hotel hasn't connected Gmail.
export async function getGmailToken(supabase: any, hotelId: string): Promise<string | null> {
  const { data: conn } = await supabase
    .from('crm_connections')
    .select('config')
    .eq('hotel_id', hotelId)
    .eq('provider', 'gmail')
    .single()

  if (!conn?.config?.access_token) return null

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
      const r = await refreshRes.json()
      accessToken = r.access_token
      await supabase
        .from('crm_connections')
        .update({ config: { ...conn.config, access_token: accessToken } })
        .eq('hotel_id', hotelId)
        .eq('provider', 'gmail')
    }
  }
  return accessToken
}

// Send a multipart (text + HTML w/ tracking pixel) email via Gmail API
export async function sendGmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  leadId: string | null
): Promise<string> {
  const boundary = 'fp_' + crypto.randomUUID().replace(/-/g, '')
  const pixelUrl = leadId
    ? `${Deno.env.get('SUPABASE_URL')}/functions/v1/track-open?lid=${leadId}`
    : null

  const htmlBody =
    `<div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#222;white-space:pre-wrap;">` +
    escapeHtml(body) +
    `</div>` +
    (pixelUrl ? `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;">` : '')

  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
    '',
    `--${boundary}--`
  ].join('\r\n')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({ raw: toBase64Url(message) })
  })

  if (!res.ok) throw new Error(`Gmail send failed: ${res.status}`)
  const data = await res.json()
  return data.id
}

function decodeBase64Url(str: string): string {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'))
}

// Pull readable text out of a Gmail API message payload
export function extractEmailBody(payload: any): string {
  if (payload.body?.data) return decodeBase64Url(payload.body.data)
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data)
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64Url(part.body.data).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      }
      if (part.parts) {
        const nested = extractEmailBody(part)
        if (nested) return nested
      }
    }
  }
  return ''
}

export function getHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

export async function callClaude(prompt: string, maxTokens = 600): Promise<any> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json'
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens: maxTokens,
      messages:   [{ role: 'user', content: prompt }]
    })
  })
  if (!res.ok) throw new Error(`Claude error: ${res.status}`)
  const data = await res.json()
  const raw = data.content[0].text
  return JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
}
