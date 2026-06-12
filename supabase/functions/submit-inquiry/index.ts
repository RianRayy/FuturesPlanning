// =============================================
// submit-inquiry Edge Function (public)
// Backs the embeddable inquiry form hotels put on
// their own websites. Direct inquiries flow straight
// into the leads pipeline as source 'webform' and
// get scored like everything else.
//
// Deployed with --no-verify-jwt — submitted by
// planners on the hotel's public website.
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const {
      hotel_id, contact_name, contact_email, contact_phone,
      company, event_type, group_size, check_in, check_out,
      budget_per_night, message
    } = await req.json()

    if (!hotel_id || !contact_name || !contact_email) {
      return new Response(
        JSON.stringify({ error: 'Name and email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!EMAIL_RE.test(contact_email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Make sure the hotel exists (don't accept junk hotel_ids)
    const { data: hotel } = await supabase
      .from('hotels')
      .select('id')
      .eq('id', hotel_id)
      .single()
    if (!hotel) {
      return new Response(
        JSON.stringify({ error: 'Unknown hotel' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { error } = await supabase.from('leads').insert({
      hotel_id,
      source:           'webform',
      contact_name:     String(contact_name).slice(0, 200),
      contact_email:    String(contact_email).slice(0, 200),
      contact_phone:    contact_phone ? String(contact_phone).slice(0, 50) : null,
      company:          company ? String(company).slice(0, 200) : null,
      event_type:       event_type || null,
      group_size:       group_size ? parseInt(group_size) : null,
      dates_requested: {
        check_in:  check_in  || null,
        check_out: check_out || null,
        flexible:  false
      },
      budget_per_night: budget_per_night ? parseFloat(budget_per_night) : null,
      raw_content:      message ? String(message).slice(0, 5000) : null,
      status:           'pending'
    })

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('submit-inquiry error:', err)
    return new Response(
      JSON.stringify({ error: 'Something went wrong — please try again' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
