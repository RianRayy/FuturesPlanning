// =============================================
// cloudbeds-data Edge Function
// Pulls LIVE availability + rates from the hotel's
// Cloudbeds PMS for a date range. This is what lets
// proposals and the bid advisor quote real numbers
// instead of estimates.
//
// Auth: property-level API key the hotel generates
// themselves in Cloudbeds (Account → Apps &
// Marketplace) — no partnership approval needed.
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const CB_BASE = 'https://api.cloudbeds.com/api/v1.2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { hotel_id, check_in, check_out, rooms } = await req.json()
    if (!hotel_id || !check_in || !check_out) {
      throw new Error('hotel_id, check_in and check_out are required')
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: conn } = await supabase
      .from('crm_connections')
      .select('config')
      .eq('hotel_id', hotel_id)
      .eq('provider', 'cloudbeds')
      .single()

    if (!conn?.config?.api_key) {
      return new Response(
        JSON.stringify({ connected: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const params = new URLSearchParams({
      startDate: check_in,
      endDate:   check_out,
      detailedRates: 'true'
    })
    if (conn.config.property_id) params.set('propertyIDs', conn.config.property_id)
    if (rooms) params.set('rooms', String(rooms))

    const cbRes = await fetch(`${CB_BASE}/getAvailableRoomTypes?${params}`, {
      headers: { 'x-api-key': conn.config.api_key }
    })

    if (!cbRes.ok) {
      const errText = await cbRes.text()
      console.error('Cloudbeds API error:', cbRes.status, errText)
      return new Response(
        JSON.stringify({ connected: true, error: `Cloudbeds API error ${cbRes.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const cbData = await cbRes.json()
    if (!cbData.success) {
      return new Response(
        JSON.stringify({ connected: true, error: cbData.message ?? 'Cloudbeds returned an error' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Normalize: total rooms available across room types + rate range
    const properties = Array.isArray(cbData.data) ? cbData.data : [cbData.data]
    const roomTypes: any[] = []
    for (const prop of properties) {
      for (const rt of (prop?.propertyRooms ?? [])) {
        const available = parseInt(rt.roomsAvailable ?? 0)
        const rate = parseFloat(rt.roomRate ?? 0)
        if (available > 0) {
          roomTypes.push({
            name:      rt.roomTypeName ?? 'Room',
            available,
            rate:      rate > 0 ? Math.round(rate) : null
          })
        }
      }
    }

    const totalAvailable = roomTypes.reduce((sum, rt) => sum + rt.available, 0)
    const rates = roomTypes.map(rt => rt.rate).filter(Boolean) as number[]

    return new Response(
      JSON.stringify({
        connected: true,
        check_in,
        check_out,
        total_rooms_available: totalAvailable,
        rate_low:  rates.length ? Math.min(...rates) : null,
        rate_high: rates.length ? Math.max(...rates) : null,
        room_types: roomTypes,
        can_fit_group: rooms ? totalAvailable >= rooms : null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('cloudbeds-data error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
