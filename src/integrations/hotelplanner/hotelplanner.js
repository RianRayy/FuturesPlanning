import { supabase } from '../../supabase'

// =============================================
// HotelPlanner.com Integration
// =============================================
// HotelPlanner.com is a high-volume group booking
// platform. Hotels listed on HotelPlanner receive
// RFPs from meeting planners and travel agents.
//
// Auth: API Key — stored in crm_connections.config
// Docs: https://api.hotelplanner.com/docs (partner portal)

const HP_BASE_URL = 'https://api.hotelplanner.com/v2'

async function getHotelPlannerConfig(hotelId) {
  const { data } = await supabase
    .from('crm_connections')
    .select('config')
    .eq('hotel_id', hotelId)
    .eq('provider', 'hotelplanner')
    .single()

  if (!data?.config?.api_key) throw new Error('No HotelPlanner connection found for this hotel')
  return data.config
}

/**
 * Fetch new RFPs from HotelPlanner.com and insert as leads.
 * HotelPlanner sends group RFPs with full event specs.
 */
export async function ingestLeads(hotelId) {
  let config
  try {
    config = await getHotelPlannerConfig(hotelId)
  } catch {
    return [] // Hotel hasn't connected HotelPlanner — skip silently
  }

  const response = await fetch(
    `${HP_BASE_URL}/rfps?hotel_id=${config.hotel_property_id}&status=new`,
    {
      headers: {
        'X-API-Key': config.api_key,
        Accept: 'application/json'
      }
    }
  )

  if (!response.ok) {
    console.error('HotelPlanner fetch failed:', await response.text())
    return []
  }

  const { rfps } = await response.json()
  if (!rfps?.length) return []

  const normalized = rfps.map(rfp => normalizeRfp(rfp, hotelId))
  return await upsertLeads(normalized, hotelId)
}

/**
 * Submit a bid/proposal back to HotelPlanner for an RFP.
 */
export async function submitHotelPlannerBid(lead, decision, hotelId) {
  const config = await getHotelPlannerConfig(hotelId)
  if (!lead.external_id) return

  await fetch(`${HP_BASE_URL}/rfps/${lead.external_id}/bid`, {
    method: 'POST',
    headers: {
      'X-API-Key': config.api_key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      rate: lead.budget_per_night,
      message: decision.draft_body,
      status: 'submitted'
    })
  })
}

/**
 * Submit a no-bid/decline to HotelPlanner.com for an RFP.
 * The meeting planner is notified through the platform.
 */
export async function declineLead(lead, hotelId) {
  if (!lead.external_id) return
  let config
  try { config = await getHotelPlannerConfig(hotelId) } catch { return }

  await fetch(`${HP_BASE_URL}/rfps/${lead.external_id}/decline`, {
    method: 'POST',
    headers: { 'X-API-Key': config.api_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'unable_to_accommodate', message: 'We appreciate your inquiry but are unable to accommodate your group at this time.' })
  })
}

// ---- Internal helpers ----

function normalizeRfp(rfp, hotelId) {
  return {
    hotel_id: hotelId,
    source: 'hotelplanner',
    external_id: String(rfp.rfp_id ?? rfp.id),
    external_url: `https://www.hotelplanner.com/rfp/${rfp.rfp_id ?? rfp.id}`,
    contact_name: rfp.contact_name ?? rfp.planner_name ?? 'Unknown',
    contact_email: rfp.contact_email ?? rfp.planner_email ?? null,
    contact_phone: rfp.contact_phone ?? null,
    company: rfp.company_name ?? rfp.organization ?? null,
    event_type: mapEventType(rfp.event_type ?? rfp.group_type),
    group_size: rfp.room_nights ?? rfp.peak_rooms ?? rfp.rooms ?? null,
    dates_requested: {
      check_in: rfp.arrival_date ?? rfp.check_in ?? null,
      check_out: rfp.departure_date ?? rfp.check_out ?? null,
      flexible: rfp.dates_flexible ?? false
    },
    budget_per_night: rfp.rate_budget ?? rfp.max_rate ?? null,
    fb_budget: rfp.fb_budget ?? null,
    special_requests: rfp.special_requests ?? rfp.notes ?? null,
    raw_content: JSON.stringify(rfp),
    status: 'pending'
  }
}

function mapEventType(raw) {
  if (!raw) return 'other'
  const lower = raw.toLowerCase()
  if (lower.includes('corporate') || lower.includes('meeting') || lower.includes('conference')) return 'corporate'
  if (lower.includes('wedding')) return 'wedding'
  if (lower.includes('social') || lower.includes('reunion') || lower.includes('party')) return 'social'
  if (lower.includes('sport') || lower.includes('tournament') || lower.includes('athletic')) return 'sports'
  if (lower.includes('government') || lower.includes('military')) return 'government'
  if (lower.includes('religious') || lower.includes('church')) return 'religious'
  if (lower.includes('tour') || lower.includes('travel') || lower.includes('leisure')) return 'tour & travel'
  return 'other'
}

async function upsertLeads(leads, hotelId) {
  const { data, error } = await supabase
    .from('leads')
    .upsert(leads, {
      onConflict: 'hotel_id,source,external_id',
      ignoreDuplicates: true
    })
    .select('id')

  if (error) console.error('HotelPlanner lead upsert error:', error)
  return data ?? []
}
