// =============================================
// cvent-decline Edge Function
// Notifies Cvent when a hotel passes on an RFP.
// The meeting planner sees the decline in their
// Cvent dashboard and can move on to other hotels.
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const CVENT_TOKEN_URL = 'https://api.cvent.com/oauth2/token'
const CVENT_BASE_URL  = 'https://api.cvent.com/ea'

async function getCventToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(CVENT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'rfp:write proposal:write'
    })
  })
  if (!res.ok) throw new Error(`Cvent token error: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { hotel_id, rfp_id } = await req.json()

    if (!hotel_id || !rfp_id) throw new Error('hotel_id and rfp_id are required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get Cvent credentials
    const { data: conn } = await supabase
      .from('crm_connections')
      .select('config')
      .eq('hotel_id', hotel_id)
      .eq('provider', 'cvent')
      .single()

    if (!conn?.config?.client_id) {
      return new Response(
        JSON.stringify({ success: true, skipped: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = await getCventToken(conn.config.client_id, conn.config.client_secret)

    // Submit decline response to Cvent
    const declineRes = await fetch(
      `${CVENT_BASE_URL}/rfps/${rfp_id}/proposals`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept:         'application/json'
        },
        body: JSON.stringify({
          status: 'Declined',
          notes:  'Thank you for the opportunity. We are unable to accommodate this group at this time and wish you the best with your event.'
        })
      }
    )

    if (!declineRes.ok) {
      // Log but don't throw — decline notification is non-critical
      console.warn(`Cvent decline response failed (${declineRes.status}):`, await declineRes.text())
    } else {
      console.log(`Cvent decline submitted for RFP ${rfp_id}`)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('cvent-decline error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
