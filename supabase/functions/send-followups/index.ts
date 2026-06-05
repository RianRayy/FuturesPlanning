// =============================================
// send-followups Edge Function
// Runs daily via pg_cron. Finds all sent leads
// with no reply and sends automated follow-up
// emails in the hotel's personal tone.
//
// Follow-up schedule:
//   - Follow-up 1: 3 days after sent (no reply)
//   - Follow-up 2: 5 days after follow-up 1 (still no reply)
//   - Stops after 2 follow-ups to avoid spamming
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function generateFollowUp(
  lead: any,
  decision: any,
  profile: any,
  followUpNumber: number
): Promise<{ subject: string; body: string }> {

  const daysSinceSent = Math.floor(
    (Date.now() - new Date(decision.sent_at).getTime()) / (1000 * 60 * 60 * 24)
  )

  const prompt = `You are writing a follow-up email on behalf of ${profile.hotels?.name ?? 'our hotel'} to a group event planner who has not yet responded to our proposal.

CONTEXT:
- Planner: ${lead.contact_name}${lead.company ? ` from ${lead.company}` : ''}
- Event: ${lead.event_type ?? 'group event'}, ${lead.group_size ?? 'unknown'} rooms
- Check-in: ${lead.dates_requested?.check_in ?? 'TBD'}
- Original email sent: ${daysSinceSent} days ago
- This is follow-up #${followUpNumber}
- Hotel tone/style: ${profile.personal_tone_summary ?? 'professional and warm'}

ORIGINAL EMAIL SUBJECT: ${decision.draft_subject}

Write a ${followUpNumber === 1 ? 'friendly first' : 'brief final'} follow-up email.
- Keep it SHORT (3-4 sentences max)
- Reference the original proposal naturally
- ${followUpNumber === 1 ? 'Express genuine interest and ask if they have questions' : 'Make it a soft last check-in, no pressure'}
- Match the hotel tone described above
- Do NOT be pushy or salesy
- Sign off from the hotel team

Respond ONLY with valid JSON, no markdown:
{
  "subject": "Re: <original subject line>",
  "body": "<full email body>"
}`

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':         Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json'
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens: 400,
      messages:   [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) throw new Error(`Claude error: ${res.status}`)
  const data = await res.json()
  const raw  = data.content[0].text
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  return JSON.parse(cleaned)
}

async function sendViaGmail(
  to: string,
  subject: string,
  body: string,
  accessToken: string
): Promise<string> {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const now = new Date()

    // Find leads that need follow-up:
    // - Email was sent
    // - Not declined/archived
    // - Has a contact email
    // - Either needs follow-up 1 or follow-up 2
    const { data: leads } = await supabase
      .from('leads')
      .select(`
        *,
        lead_decisions(
          score, draft_subject, draft_body, sent_at,
          follow_up_1_sent_at, follow_up_2_sent_at, follow_up_days
        )
      `)
      .eq('status', 'processed')
      .not('lead_decisions.sent_at', 'is', null)
      .not('contact_email', 'is', null)

    if (!leads?.length) {
      return new Response(
        JSON.stringify({ success: true, processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let sent = 0

    for (const lead of leads) {
      const decision = lead.lead_decisions
      if (!decision?.sent_at) continue

      const sentAt       = new Date(decision.sent_at)
      const followUpDays = decision.follow_up_days ?? 3
      const daysSinceSent = (now.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24)

      // Check if planner has already replied
      const { data: replies } = await supabase
        .from('email_threads')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('direction', 'inbound')
        .limit(1)

      if (replies?.length) continue // They replied — skip

      // Determine which follow-up to send
      let followUpNumber = 0
      if (!decision.follow_up_1_sent_at && daysSinceSent >= followUpDays) {
        followUpNumber = 1
      } else if (
        decision.follow_up_1_sent_at &&
        !decision.follow_up_2_sent_at &&
        daysSinceSent >= followUpDays + 5
      ) {
        followUpNumber = 2
      }

      if (!followUpNumber) continue

      // Get Gmail token for this hotel
      const { data: conn } = await supabase
        .from('crm_connections')
        .select('config')
        .eq('hotel_id', lead.hotel_id)
        .eq('provider', 'gmail')
        .single()

      if (!conn?.config?.access_token) continue

      // Refresh token
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
            .eq('hotel_id', lead.hotel_id)
            .eq('provider', 'gmail')
        }
      }

      // Get hotel profile for tone
      const { data: profile } = await supabase
        .from('hotel_profiles')
        .select('*, hotels(name)')
        .eq('hotel_id', lead.hotel_id)
        .single()

      // Generate follow-up with Claude
      let followUp
      try {
        followUp = await generateFollowUp(lead, decision, profile, followUpNumber)
      } catch (err) {
        console.error(`Follow-up generation failed for lead ${lead.id}:`, err)
        continue
      }

      // Send via Gmail
      try {
        await sendViaGmail(lead.contact_email, followUp.subject, followUp.body, accessToken)
      } catch (err) {
        console.error(`Gmail send failed for lead ${lead.id}:`, err)
        continue
      }

      // Log in email_threads
      await supabase.from('email_threads').insert({
        lead_id:    lead.id,
        hotel_id:   lead.hotel_id,
        direction:  'outbound',
        subject:    followUp.subject,
        body:       followUp.body,
        to_address: lead.contact_email
      })

      // Update follow-up timestamp
      const updateField = followUpNumber === 1 ? 'follow_up_1_sent_at' : 'follow_up_2_sent_at'
      await supabase
        .from('lead_decisions')
        .update({ [updateField]: now.toISOString() })
        .eq('lead_id', lead.id)

      sent++
      console.log(`Follow-up ${followUpNumber} sent for lead ${lead.id} to ${lead.contact_email}`)
    }

    return new Response(
      JSON.stringify({ success: true, processed: leads.length, sent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('send-followups error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
