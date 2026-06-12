// =============================================
// track-open Edge Function
// Serves an invisible 1x1 GIF embedded in outgoing
// emails. When the planner's email client loads it,
// we record the open on lead_decisions.
//
// Deployed with --no-verify-jwt — email clients hit
// this URL with no auth headers. The lead_id is a
// UUID, which is effectively unguessable, so it
// doubles as the tracking token.
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 1x1 transparent GIF
const PIXEL = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  c => c.charCodeAt(0)
)

const PIXEL_HEADERS = {
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0'
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const leadId = url.searchParams.get('lid')
    if (!leadId) return new Response(PIXEL, { headers: PIXEL_HEADERS })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const now = new Date().toISOString()

    // Read current state so we only set first-open once
    const { data: decision } = await supabase
      .from('lead_decisions')
      .select('email_opened_at, email_open_count, sent_at')
      .eq('lead_id', leadId)
      .single()

    if (decision?.sent_at) {
      // Ignore loads within 60s of sending — that's the sender's own
      // client (or Gmail's proxy) prefetching the image, not the planner
      const secondsSinceSent = (Date.now() - new Date(decision.sent_at).getTime()) / 1000
      if (secondsSinceSent > 60) {
        await supabase
          .from('lead_decisions')
          .update({
            email_opened_at:      decision.email_opened_at ?? now,
            email_last_opened_at: now,
            email_open_count:     (decision.email_open_count ?? 0) + 1
          })
          .eq('lead_id', leadId)
      }
    }
  } catch (err) {
    // Never fail — always return the pixel
    console.error('track-open error:', err)
  }

  return new Response(PIXEL, { headers: PIXEL_HEADERS })
})
