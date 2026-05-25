import { supabase } from '../../supabase'

// =============================================
// Cvent Integration
// =============================================
// Cvent is the dominant RFP platform for group
// sales. Hotels receive RFPs (Request for Proposals)
// from meeting planners directly via Cvent Supplier.
//
// Auth: OAuth 2.0 client credentials flow
// Docs: https://developers.cvent.com/documentation
//
// Key objects:
//   - RFP (Request for Proposal) — the inbound lead
//   - Event — the planner's event details
//   - Account — the planner's organization

const CVENT_BASE_URL = 'https://api.cvent.com/ea'

async function getCventToken(hotelId) {
  const { data } = await supabase
    .from('crm_connections')
    .select('access_token, refresh_token, token_expires_at, config')
    .eq('hotel_id', hotelId)
    .eq('provider', 'cvent')
    .single()

  if (!data) throw new Error('No Cvent connection found for this hotel')
  // TODO: auto-refresh using client_id + client_secret from config
  return data.access_token
}

/**
 * Fetch new RFPs from Cvent and insert as leads.
 * Cvent RFPs are the gold standard for group sales leads —
 * they contain full event specs, room blocks, and planner contact info.
 */
export async function ingestLeads(hotelId) {
  let token
  try {
    token = await getCventToken(hotelId)
  } catch {
    return [] // Hotel hasn't connected Cvent — skip silently
  }

  // Fetch RFPs in 'Received' status (new, not yet responded to)
  const response = await fetch(
    `${CVENT_BASE_URL}/rfps?filter=status eq 'Received'&expand=event,account,contact`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    }
  )

  if (!response.ok) {
    console.error('Cvent fetch failed:', await response.text())
    return []
  }

  const { data: rfps } = await response.json()
  if (!rfps?.length) return []

  const normalized = rfps.map(rfp => normalizeRfp(rfp, hotelId))
  return await upsertLeads(normalized, hotelId)
}

/**
 * Submit a proposal/response back to Cvent for an RFP.
 * Called after the agent drafts and the user approves.
 */
export async function submitCventProposal(lead, decision, hotelId) {
  const token = await getCventToken(hotelId)
  if (!lead.external_id) return

  await fetch(`${CVENT_BASE_URL}/rfps/${lead.external_id}/proposals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'Submitted',
      notes: decision.draft_body,
      proposedRate: lead.budget_per_night
    })
  })
}

/**
 * Submit a decline/pass response to Cvent for an RFP.
 * The planner is automatically notified through the Cvent platform.
 */
export async function declineLead(lead, hotelId) {
  if (!lead.external_id) return
  let token
  try { token = await getCventToken(hotelId) } catch { return }

  await fetch(`${CVENT_BASE_URL}/rfps/${lead.external_id}/response`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Declined', notes: 'We are unable to accommodate this group at this time. We appreciate the opportunity.' })
  })
}

// ---- Internal helpers ----

function normalizeRfp(rfp, hotelId) {
  const event = rfp.event ?? {}
  const contact = rfp.contact ?? {}
  const account = rfp.account ?? {}

  // Cvent uses ISO dates directly
  const checkIn = event.startDate ?? null
  const checkOut = event.endDate ?? null

  // Map Cvent event types to our taxonomy
  const eventTypeMap = {
    'Corporate Meeting': 'corporate',
    'Conference': 'corporate',
    'Trade Show': 'corporate',
    'Wedding': 'wedding',
    'Social Event': 'social',
    'Sports Event': 'sports',
    'Government': 'government',
    'Religious': 'religious',
    'Tour & Travel': 'tour & travel'
  }

  return {
    hotel_id: hotelId,
    source: 'cvent',
    external_id: rfp.id,
    external_url: `https://supplier.cvent.com/rfps/${rfp.id}`,
    contact_name: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unknown',
    contact_email: contact.email ?? null,
    contact_phone: contact.phone ?? null,
    company: account.name ?? null,
    event_type: eventTypeMap[event.type] ?? 'other',
    group_size: event.peakRooms ?? event.estimatedRooms ?? null,
    dates_requested: {
      check_in: checkIn,
      check_out: checkOut,
      flexible: event.datesFlexible ?? false
    },
    budget_per_night: event.budgetPerRoom ?? null,
    fb_budget: event.foodBeverageBudget ?? null,
    special_requests: event.specialRequests ?? null,
    raw_content: JSON.stringify(rfp),
    status: 'pending'
  }
}

async function upsertLeads(leads, hotelId) {
  const { data, error } = await supabase
    .from('leads')
    .upsert(leads, {
      onConflict: 'hotel_id,source,external_id',
      ignoreDuplicates: true
    })
    .select('id')

  if (error) console.error('Cvent lead upsert error:', error)
  return data ?? []
}
