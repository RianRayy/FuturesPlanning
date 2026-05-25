import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { hotelId, emailSamples } = await req.json()

    let emailText = emailSamples ?? ''

    // If no samples pasted, try to pull from connected Gmail or Outlook
    if (!emailText.trim() && hotelId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      const { data: conn } = await supabase
        .from('crm_connections')
        .select('provider, config')
        .eq('hotel_id', hotelId)
        .in('provider', ['gmail', 'outlook'])
        .limit(1)
        .single()

      if (conn?.config?.access_token) {
        // Fetch recent sent emails from Gmail
        if (conn.provider === 'gmail') {
          const listRes = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=10',
            { headers: { Authorization: `Bearer ${conn.config.access_token}` } }
          )
          if (listRes.ok) {
            const listData = await listRes.json()
            const messages = listData.messages ?? []

            const bodies: string[] = []
            for (const msg of messages.slice(0, 8)) {
              const msgRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
                { headers: { Authorization: `Bearer ${conn.config.access_token}` } }
              )
              if (!msgRes.ok) continue
              const msgData = await msgRes.json()
              const part = msgData.payload?.parts?.find((p: any) => p.mimeType === 'text/plain')
                ?? msgData.payload
              if (part?.body?.data) {
                const decoded = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/'))
                bodies.push(decoded.slice(0, 600))
              }
            }
            emailText = bodies.join('\n\n---\n\n')
          }
        }

        // Fetch from Outlook
        if (conn.provider === 'outlook') {
          const listRes = await fetch(
            'https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$top=10&$select=body,subject',
            { headers: { Authorization: `Bearer ${conn.config.access_token}` } }
          )
          if (listRes.ok) {
            const listData = await listRes.json()
            const bodies = (listData.value ?? [])
              .map((m: any) => m.body?.content?.replace(/<[^>]+>/g, '').slice(0, 600))
              .filter(Boolean)
            emailText = bodies.join('\n\n---\n\n')
          }
        }
      }
    }

    if (!emailText.trim()) {
      return new Response(JSON.stringify({ error: 'No email content to analyze' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Ask Claude to extract a concise tone/style summary
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      system: `You are a writing style analyst. Your job is to read a person's emails and produce a precise,
actionable description of their writing style that another AI can use to perfectly mimic it.
Focus on: sentence length, formality level, use of first names, how they open and close,
punctuation habits, use of exclamation marks, humor or personality, typical phrases they use.
Keep it under 200 words. Write in second person: "You write in short sentences..."`,
      messages: [{
        role: 'user',
        content: `Here are emails this person has written. Analyze their writing style:\n\n${emailText}`
      }]
    })

    const summary = message.content[0].text

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('analyze-tone error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
