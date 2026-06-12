// =============================================
// analyze-website Edge Function
// AI self-onboarding: hotel pastes their website
// URL, we fetch the site (plus likely event/group
// pages), and Claude extracts the full hotel
// profile — description, room count, event spaces,
// target segments, brand voice. Writes straight to
// hotel_profiles so setup takes minutes, not forms.
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// Subpages worth checking for group/event details
const SUBPATHS = ['', '/meetings', '/events', '/weddings', '/groups', '/meetings-events', '/about']

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchPage(url: string): Promise<string | null> {
  // 1. Direct fetch with a real browser UA
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' }
    })
    if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) {
      const text = htmlToText(await res.text())
      if (text.length > 500) return text
    }
  } catch { /* fall through */ }

  // 2. Fallback: Jina Reader renders JS and gets past most WAFs —
  // hotel sites (esp. luxury chains) often block plain fetches
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(25000),
      headers: { 'Accept': 'text/plain' }
    })
    if (!res.ok) return null
    const text = await res.text()
    if (text.includes('Warning: Target URL returned error')) return null
    return text.replace(/\s+/g, ' ').trim()
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { hotel_id, url } = await req.json()
    if (!hotel_id || !url) throw new Error('hotel_id and url are required')

    // Normalize URL
    let baseUrl = url.trim()
    if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'https://' + baseUrl
    baseUrl = baseUrl.replace(/\/+$/, '')

    // Fetch the homepage + likely group/event pages in parallel
    const pages = await Promise.all(SUBPATHS.map(p => fetchPage(baseUrl + p)))
    const content = pages
      .filter(Boolean)
      .map((text, i) => `--- PAGE ${SUBPATHS[i] || '/'} ---\n${text!.slice(0, 6000)}`)
      .join('\n\n')

    if (!content || content.length < 200) {
      return new Response(
        JSON.stringify({ error: 'Could not read that website. Check the URL and try again.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Claude extracts the profile
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         (Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim(),
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: `You are onboarding a hotel onto a group sales platform. Below is text scraped from the hotel's website. Extract their profile.

${content.slice(0, 24000)}

Respond ONLY with valid JSON, no markdown. Use null for anything not found — do NOT guess numbers:
{
  "hotel_name": "<official hotel name or null>",
  "hotel_description": "<2-3 sentence description written for use in sales emails — highlight what makes this property special for groups/events. Write it in the hotel's own voice.>",
  "room_count": <integer or null>,
  "event_spaces": [{ "name": "<space name>", "capacity": <integer or null>, "sqft": <integer or null> }],
  "target_segments": [<from: "corporate", "wedding", "social", "sports", "conference" — based on what the site emphasizes>],
  "tone_of_voice": "professional" | "warm" | "luxury",
  "tone_summary": "<1-2 sentences describing the brand voice so an AI can write emails matching it>",
  "amenities_highlights": "<one sentence of standout amenities worth mentioning in proposals, or null>"
}`
        }]
      })
    })

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text()
      console.error('Claude error body:', errBody)
      throw new Error(`Claude error: ${claudeRes.status} ${errBody.slice(0, 200)}`)
    }
    const claudeData = await claudeRes.json()
    const raw = claudeData.content[0].text
    const extracted = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Merge non-null extracted values into hotel_profiles
    const updates: Record<string, unknown> = { website_url: baseUrl, updated_at: new Date().toISOString() }
    if (extracted.hotel_description) {
      updates.hotel_description = extracted.amenities_highlights
        ? `${extracted.hotel_description} ${extracted.amenities_highlights}`
        : extracted.hotel_description
    }
    if (extracted.room_count)             updates.room_count = extracted.room_count
    if (extracted.event_spaces?.length)   updates.event_spaces = extracted.event_spaces
    if (extracted.target_segments?.length) updates.target_segments = extracted.target_segments
    if (extracted.tone_of_voice)          updates.tone_of_voice = extracted.tone_of_voice
    if (extracted.tone_summary)           updates.personal_tone_summary = extracted.tone_summary

    await supabase
      .from('hotel_profiles')
      .upsert({ hotel_id, ...updates }, { onConflict: 'hotel_id' })

    // Update hotel name if we found one and it's currently generic
    if (extracted.hotel_name) {
      const { data: hotel } = await supabase.from('hotels').select('name').eq('id', hotel_id).single()
      if (!hotel?.name || hotel.name.length < 3) {
        await supabase.from('hotels').update({ name: extracted.hotel_name }).eq('id', hotel_id)
      }
    }

    return new Response(
      JSON.stringify({ success: true, extracted }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('analyze-website error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
