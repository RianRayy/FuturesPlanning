// =============================================
// mews-data Edge Function
// Reads LIVE room availability from a hotel's Mews
// PMS for a date range. Verified end-to-end against
// the Mews demo environment.
//
// Auth model (Mews Connector API):
//   - ClientToken  = identifies OUR app (one value,
//     stored as the MEWS_CLIENT_TOKEN secret). In
//     production this comes from Mews certification;
//     the demo token works for testing today.
//   - AccessToken  = per-hotel, the hotel provides it
//     from their Mews enterprise (stored in
//     crm_connections.config.access_token).
//
// Flow (all verified against live demo):
//   1. configuration/get  → enterprise timezone
//   2. services/getAll     → reservable (accommodation) services
//   3. services/getAvailability per service → per-category counts
//   4. resourceCategories/getAll → category display names
// =============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// Demo enterprise AccessToken — used when a hotel hasn't connected
// their own Mews yet, so the integration is always demoable.
const DEMO_ACCESS_TOKEN = '4D6C7ABE0E6A4681B0AFB16900AE5D86-DF50CBC89E1D4FF5859DDF021649ED5'
const DEMO_CLIENT_TOKEN = 'E0D439EE522F44368DC78E1BFB03710C-D24FB11DBE31D4621C4817E028D9E1D'
const DEMO_BASE = 'https://api.mews-demo.com'
const PROD_BASE = 'https://api.mews.com'

// UTC instant when it's local midnight on `dateStr` in IANA `tz`.
// DST-safe — verified to produce 04:00Z for America/New_York in July.
function localMidnightToUtc(dateStr: string, tz: string): string {
  const naiveUtc = new Date(dateStr + 'T00:00:00Z').getTime()
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(naiveUtc))) parts[p.type] = p.value
  let hour = parts.hour === '24' ? '00' : parts.hour
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second)
  const offset = asUtc - naiveUtc
  return new Date(naiveUtc - offset).toISOString().replace(/\.\d{3}Z$/, '.000Z')
}

async function mews(base: string, op: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/connector/v1/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  })
  const data = await res.json()
  if (!res.ok || data.Message) throw new Error(data.Message ?? `Mews ${op} ${res.status}`)
  return data
}

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
      .eq('provider', 'mews')
      .single()

    // Real connection → real tokens & prod. Otherwise fall back to the
    // open demo enterprise so the feature is always live to show.
    const isReal       = !!conn?.config?.access_token
    const accessToken  = conn?.config?.access_token ?? DEMO_ACCESS_TOKEN
    const clientToken  = Deno.env.get('MEWS_CLIENT_TOKEN') ?? DEMO_CLIENT_TOKEN
    const base         = isReal ? PROD_BASE : DEMO_BASE
    const auth = { ClientToken: clientToken, AccessToken: accessToken, Client: 'FuturesPlanning 1.0.0' }

    // 1. Enterprise timezone for the night boundary
    const config = await mews(base, 'configuration/get', auth)
    const tz = config.Enterprise?.TimeZoneIdentifier ?? 'UTC'
    const firstNight = localMidnightToUtc(check_in, tz)
    const lastNight  = localMidnightToUtc(check_out, tz)

    // 2. Reservable (accommodation) services
    const svc = await mews(base, 'services/getAll', { ...auth, Limitation: { Count: 50 } })
    const reservable = (svc.Services ?? []).filter((s: any) => s.Type === 'Reservable')

    // 3. Availability per service; aggregate categories that return data
    const categoryCounts: Record<string, number[]> = {}
    const serviceIds: string[] = []
    for (const s of reservable) {
      try {
        const av = await mews(base, 'services/getAvailability', {
          ...auth,
          ServiceId: s.Id,
          FirstTimeUnitStartUtc: firstNight,
          LastTimeUnitStartUtc:  lastNight
        })
        for (const c of (av.CategoryAvailabilities ?? [])) {
          if (c.Availabilities?.length) {
            categoryCounts[c.CategoryId] = c.Availabilities
            if (!serviceIds.includes(s.Id)) serviceIds.push(s.Id)
          }
        }
      } catch {
        // service not bookable for this range — skip
      }
    }

    const categoryIds = Object.keys(categoryCounts)
    if (categoryIds.length === 0) {
      return new Response(
        JSON.stringify({ connected: true, demo: !isReal, total_rooms_available: 0, room_types: [], can_fit_group: rooms ? false : null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Category names
    let names: Record<string, string> = {}
    try {
      const cats = await mews(base, 'resourceCategories/getAll', {
        ...auth, ServiceIds: serviceIds, Limitation: { Count: 100 }
      })
      for (const c of (cats.ResourceCategories ?? [])) {
        const n = c.Names ?? {}
        names[c.Id] = n['en-US'] ?? Object.values(n)[0] ?? 'Room'
      }
    } catch { /* names are cosmetic */ }

    // tightest night per category, then overall
    const roomTypes = categoryIds.map(id => ({
      name:      names[id] ?? 'Room',
      available: Math.min(...categoryCounts[id])
    })).filter(rt => rt.available > 0)

    const nights = categoryCounts[categoryIds[0]].length
    let tightest = Infinity
    for (let i = 0; i < nights; i++) {
      const nightTotal = categoryIds.reduce((sum, id) => sum + (categoryCounts[id][i] ?? 0), 0)
      tightest = Math.min(tightest, nightTotal)
    }
    const totalAvailable = tightest === Infinity ? 0 : tightest

    return new Response(
      JSON.stringify({
        connected: true,
        demo: !isReal,
        check_in,
        check_out,
        total_rooms_available: totalAvailable,
        room_types: roomTypes,
        can_fit_group: rooms ? totalAvailable >= rooms : null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('mews-data error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
