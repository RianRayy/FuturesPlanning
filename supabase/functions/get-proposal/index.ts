// =============================================
// get-proposal Edge Function (public)
// Backs the branded proposal page at /p/:leadId.
// Returns sanitized proposal data for a lead and
// logs each visit (view count + timestamps).
//
// Deployed with --no-verify-jwt — planners open
// this from an email link with no auth. The lead
// UUID is the access token (unguessable).
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const leadId = url.searchParams.get('lid')
    if (!leadId) throw new Error('lid is required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: lead } = await supabase
      .from('leads')
      .select(`
        id, contact_name, company, event_type, group_size, dates_requested,
        hotel_id,
        lead_decisions(draft_subject, draft_body, sent_at, bid_rate, proposal_view_count, proposal_viewed_at)
      `)
      .eq('id', leadId)
      .single()

    // Only sent proposals are viewable
    if (!lead || !lead.lead_decisions?.sent_at) {
      return new Response(
        JSON.stringify({ error: 'Proposal not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: hotel } = await supabase
      .from('hotels')
      .select('name')
      .eq('id', lead.hotel_id)
      .single()

    const { data: profile } = await supabase
      .from('hotel_profiles')
      .select('hotel_description')
      .eq('hotel_id', lead.hotel_id)
      .single()

    // Hotel contact email (reply-to for the planner)
    const { data: hotelUser } = await supabase
      .from('hotel_users')
      .select('user_id')
      .eq('hotel_id', lead.hotel_id)
      .limit(1)
      .single()
    let hotelEmail: string | null = null
    if (hotelUser?.user_id) {
      const { data: authUser } = await supabase.auth.admin.getUserById(hotelUser.user_id)
      hotelEmail = authUser?.user?.email ?? null
    }

    // Log the visit
    const d = lead.lead_decisions
    await supabase
      .from('lead_decisions')
      .update({
        proposal_viewed_at:  d.proposal_viewed_at ?? new Date().toISOString(),
        proposal_view_count: (d.proposal_view_count ?? 0) + 1
      })
      .eq('lead_id', leadId)

    return new Response(
      JSON.stringify({
        hotel_name:        hotel?.name ?? 'Hotel',
        hotel_description: profile?.hotel_description ?? null,
        hotel_email:       hotelEmail,
        contact_name:      lead.contact_name,
        company:           lead.company,
        event_type:        lead.event_type,
        group_size:        lead.group_size,
        check_in:          lead.dates_requested?.check_in ?? null,
        check_out:         lead.dates_requested?.check_out ?? null,
        bid_rate:          d.bid_rate ?? null,
        subject:           d.draft_subject,
        body:              d.draft_body,
        sent_at:           d.sent_at
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('get-proposal error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
