// =============================================
// cvent-submit-proposal Edge Function
// Submits a bid/proposal back to Cvent when the
// user clicks Approve & Send on a Cvent lead.
//
// This notifies the meeting planner through the
// Cvent platform with the hotel's rate and response.
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
    const { hotel_id, rfp_id, rate, email_body } = await req.json()

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
      // Not connected — not a failure, just skip silently
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'Cvent not connected' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = await getCventToken(conn.config.client_id, conn.config.client_secret)

    // Submit proposal to Cvent
    const proposalRes = await fetch(
      `${CVENT_BASE_URL}/rfps/${rfp_id}/proposals`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept:         'application/json'
        },
        body: JSON.stringify({
          status:       'Submitted',
          proposedRate: rate ?? null,
          notes:        email_body ?? '',
          // Cvent requires at minimum a status and notes
        })
      }
    )

    if (!proposalRes.ok) {
      const errText = await proposalRes.text()
      throw new Error(`Cvent proposal submit failed (${proposalRes.status}): ${errText}`)
    }

    const result = await proposalRes.json()
    console.log(`Cvent proposal submitted for RFP ${rfp_id}:`, result.id ?? 'ok')

    return new Response(
      JSON.stringify({ success: true, proposalId: result.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('cvent-submit-proposal error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
