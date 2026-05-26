// =============================================
// cvent-ingest Edge Function
// Polls Cvent Supplier Network for new RFPs
// and inserts them as pending leads.
//
// Called on dashboard load and on a schedule.
// Credentials never leave Supabase — the browser
// only triggers this function, never talks to Cvent.
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const CVENT_TOKEN_URL = 'https://api.cvent.com/oauth2/token'
const CVENT_BASE_URL  = 'https://api.cvent.com/ea'

// ---- OAuth token retrieval ----

async function getCventToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(CVENT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'rfp:read rfp:write proposal:write event:read contact:read account:read'
    })
  })

  if (!res.ok) throw new Error(`Cvent token error: ${await res.text()}`)
  const data = await res.json()
  return data.access_token
}

// ---- RFP normalization ----

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
    hotel_id:     hotelId,
    source:       'cvent',
    external_id:  rfp.id,
    external_url: `https://supplier.cvent.com/rfps/${rfp.id}`,
    contact_name: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unknown',
    contact_email: contact.email  ?? null,
    contact_phone: contact.phone  ?? null,
    company:       account.name   ?? null,
    event_type:    EVENT_TYPE_MAP[event.type] ?? 'other',
    group_size:    event.peakRooms ?? event.estimatedRooms ?? null,
    dates_requested: {
      check_in:  event.startDate   ?? null,
      check_out: event.endDate     ?? null,
      flexible:  event.datesFlexible ?? false
    },
    budget_per_night: event.budgetPerRoom         ?? null,
    fb_budget:        event.foodBeverageBudget    ?? null,
    special_requests: event.specialRequests       ?? null,
    raw_content:      JSON.stringify(rfp),
    status:           'pending'
  }
}

// ---- Main handler ----

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { hotel_id } = await req.json()
    if (!hotel_id) throw new Error('hotel_id is required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 1. Get Cvent credentials stored during connection setup
    const { data: conn } = await supabase
      .from('crm_connections')
      .select('config')
      .eq('hotel_id', hotel_id)
      .eq('provider', 'cvent')
      .single()

    if (!conn?.config?.client_id || !conn?.config?.client_secret) {
      return new Response(
        JSON.stringify({ leads: [], message: 'Cvent not connected' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Get OAuth access token
    const token = await getCventToken(conn.config.client_id, conn.config.client_secret)

    // 3. Fetch RFPs in 'Received' status (new, not yet responded to)
    const rfpRes = await fetch(
      `${CVENT_BASE_URL}/rfps?filter=status eq 'Received'&expand=event,account,contact&top=50`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    )

    if (!rfpRes.ok) throw new Error(`Cvent RFP fetch failed: ${await rfpRes.text()}`)

    const { data: rfps = [] } = await rfpRes.json()
    if (!rfps.length) return new Response(
      JSON.stringify({ leads: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

    // 4. Normalize and upsert — ignoreDuplicates prevents re-processing
    const normalized = rfps.map((rfp: any) => normalizeRfp(rfp, hotel_id))
    const { data: inserted, error } = await supabase
      .from('leads')
      .upsert(normalized, { onConflict: 'hotel_id,source,external_id', ignoreDuplicates: true })
      .select('id')

    if (error) throw error

    return new Response(
      JSON.stringify({ leads: inserted ?? [], count: inserted?.length ?? 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('cvent-ingest error:', err)
    return new Response(
      JSON.stringify({ error: err.message, leads: [] }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
