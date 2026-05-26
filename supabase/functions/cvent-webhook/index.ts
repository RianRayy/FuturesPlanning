// =============================================
// cvent-webhook Edge Function
// Receives real-time RFP push notifications from
// Cvent's Push Notification System (PNS).
//
// Register this URL in Cvent Developer Portal → PNS:
//   https://{PROJECT_REF}.supabase.co/functions/v1/cvent-webhook?hotel_id={hotel_id}
//
// Cvent sends a POST for each new RFP_SEND or
// RFP_FORWARD event. We immediately fetch the full
// RFP and create a pending lead — scoring runs next.
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cvent-signature'
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
      scope:         'rfp:read event:read contact:read account:read'
    })
  })
  if (!res.ok) throw new Error(`Cvent token error: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

function normalizeRfp(rfp: any, hotelId: string) {
  const event   = rfp.event   ?? {}
  const contact = rfp.contact ?? {}
  const account = rfp.account ?? {}

  const EVENT_TYPE_MAP: Record<string, string> = {
    'Corporate Meeting': 'corporate',
    'Conference':        'corporate',
    'Trade Show':        'corporate',
    'Wedding':           'wedding',
    'Social Event':      'social',
    'Sports Event':      'sports',
    'Government':        'government',
    'Religious':         'religious',
    'Tour & Travel':     'tour & travel'
  }

  return {
    hotel_id:      hotelId,
    source:        'cvent',
    external_id:   rfp.id,
    external_url:  `https://supplier.cvent.com/rfps/${rfp.id}`,
    contact_name:  `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unknown',
    contact_email: contact.email ?? null,
    contact_phone: contact.phone ?? null,
    company:       account.name  ?? null,
    event_type:    EVENT_TYPE_MAP[event.type] ?? 'other',
    group_size:    event.peakRooms ?? event.estimatedRooms ?? null,
    dates_requested: {
      check_in:  event.startDate     ?? null,
      check_out: event.endDate       ?? null,
      flexible:  event.datesFlexible ?? false
    },
    budget_per_night: event.budgetPerRoom      ?? null,
    fb_budget:        event.foodBeverageBudget ?? null,
    special_requests: event.specialRequests    ?? null,
    raw_content:      JSON.stringify(rfp),
    status:           'pending'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // hotel_id is passed as a query param when registering the webhook URL
    const url      = new URL(req.url)
    const hotel_id = url.searchParams.get('hotel_id')

    if (!hotel_id) {
      return new Response('Missing hotel_id', { status: 400, headers: corsHeaders })
    }

    const body = await req.json()
    console.log('Cvent PNS notification received:', JSON.stringify(body))

    // Cvent sends { type, rfpId, supplierId, ... }
    const rfpId = body.rfpId ?? body.id
    const type  = body.type ?? body.eventType

    // Only handle new RFP notifications
    if (!rfpId || !['RFP_SEND', 'RFP_FORWARD'].includes(type)) {
      return new Response(JSON.stringify({ received: true, action: 'ignored' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get hotel's Cvent credentials
    const { data: conn } = await supabase
      .from('crm_connections')
      .select('config')
      .eq('hotel_id', hotel_id)
      .eq('provider', 'cvent')
      .single()

    if (!conn?.config?.client_id) {
      return new Response('Cvent not connected for this hotel', { status: 400, headers: corsHeaders })
    }

    // Get token and fetch full RFP details
    const token  = await getCventToken(conn.config.client_id, conn.config.client_secret)
    const rfpRes = await fetch(
      `${CVENT_BASE_URL}/rfps/${rfpId}?expand=event,account,contact`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    )

    if (!rfpRes.ok) throw new Error(`Failed to fetch RFP ${rfpId}: ${await rfpRes.text()}`)

    const rfp        = await rfpRes.json()
    const normalized = normalizeRfp(rfp, hotel_id)

    // Upsert lead — scoring agent picks it up automatically
    const { error } = await supabase
      .from('leads')
      .upsert(normalized, { onConflict: 'hotel_id,source,external_id', ignoreDuplicates: true })

    if (error) throw error

    console.log(`Cvent lead created for hotel ${hotel_id}: RFP ${rfpId}`)

    return new Response(
      JSON.stringify({ received: true, rfpId, hotel_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('cvent-webhook error:', err)
    // Return 200 to Cvent so they don't retry — we log and move on
    return new Response(
      JSON.stringify({ received: true, error: err.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
