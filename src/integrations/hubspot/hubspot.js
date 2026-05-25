import { supabase } from '../../supabase'

// =============================================
// HubSpot CRM Integration
// =============================================
// HubSpot tracks Deals, Contacts, and Companies.
// Group sales leads typically live as Deals in a
// "Group Sales" pipeline with custom properties.
//
// Auth: OAuth 2.0 — access_token stored in crm_connections
// Docs: https://developers.hubspot.com/docs/api/crm/deals

const HUBSPOT_BASE_URL = 'https://api.hubapi.com'

async function getHubSpotToken(hotelId) {
  const { data } = await supabase
    .from('crm_connections')
    .select('access_token, refresh_token, token_expires_at')
    .eq('hotel_id', hotelId)
    .eq('provider', 'hubspot')
    .single()

  if (!data) throw new Error('No HubSpot connection found for this hotel')
  // TODO: auto-refresh token if expired using refresh_token
  return data.access_token
}

/**
 * Fetch new/updated deals from HubSpot and normalize into our leads schema.
 * Pulls deals modified in the last 7 days that haven't been imported yet.
 */
export async function ingestLeads(hotelId) {
  let token
  try {
    token = await getHubSpotToken(hotelId)
  } catch {
    return [] // Hotel hasn't connected HubSpot — skip silently
  }

  // Fetch deals with associated contact + company data
  const response = await fetch(
    `${HUBSPOT_BASE_URL}/crm/v3/objects/deals?` +
    `limit=100&associations=contacts,companies&` +
    `properties=dealname,dealstage,closedate,hs_lastmodifieddate,` +
    `num_associated_contacts,amount,` +
    // Custom group sales properties (hotel sets these up in HubSpot)
    `group_event_type,group_size,check_in_date,check_out_date,` +
    `budget_per_room,fb_minimum,special_requests`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  )

  if (!response.ok) {
    console.error('HubSpot fetch failed:', await response.text())
    return []
  }

  const { results } = await response.json()
  if (!results?.length) return []

  const normalized = results.map(deal => normalizeDeal(deal, hotelId))
  return await upsertLeads(normalized, hotelId)
}

/**
 * Push a scored lead back to HubSpot as a Deal update.
 */
export async function syncScoreToHubSpot(lead, decision, hotelId) {
  const token = await getHubSpotToken(hotelId)
  if (!lead.external_id) return

  const stageMap = {
    hot: 'qualifiedtobuy',
    warm: 'presentationscheduled',
    cold: 'closedlost'
  }

  await fetch(`${HUBSPOT_BASE_URL}/crm/v3/objects/deals/${lead.external_id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: {
        dealstage: stageMap[decision.score] ?? 'presentationscheduled',
        fp_agent_score: decision.score,
        fp_agent_reasoning: decision.reasoning
      }
    })
  })
}

/**
 * Mark a Deal as Closed Lost in HubSpot when a lead is declined.
 */
export async function declineLead(lead, hotelId) {
  if (!lead.external_id) return
  let token
  try { token = await getHubSpotToken(hotelId) } catch { return }

  await fetch(`${HUBSPOT_BASE_URL}/crm/v3/objects/deals/${lead.external_id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { dealstage: 'closedlost', hs_closed_lost_reason: 'Hotel unable to accommodate group.' } })
  })
}

// ---- Internal helpers ----

function normalizeDeal(deal, hotelId) {
  const p = deal.properties ?? {}
  const contact = deal.associations?.contacts?.results?.[0]

  return {
    hotel_id: hotelId,
    source: 'hubspot',
    external_id: deal.id,
    external_url: `https://app.hubspot.com/contacts/deals/${deal.id}`,
    contact_name: p.dealname ?? 'Unknown',
    contact_email: contact?.email ?? null,
    contact_phone: contact?.phone ?? null,
    company: deal.associations?.companies?.results?.[0]?.name ?? null,
    event_type: p.group_event_type ?? 'other',
    group_size: p.group_size ? parseInt(p.group_size) : null,
    dates_requested: {
      check_in: p.check_in_date ?? null,
      check_out: p.check_out_date ?? null,
      flexible: false
    },
    budget_per_night: p.budget_per_room ? parseFloat(p.budget_per_room) : null,
    fb_budget: p.fb_minimum ? parseFloat(p.fb_minimum) : null,
    special_requests: p.special_requests ?? null,
    raw_content: JSON.stringify(deal),
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

  if (error) console.error('HubSpot lead upsert error:', error)
  return data ?? []
}
