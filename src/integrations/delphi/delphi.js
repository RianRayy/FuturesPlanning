import { supabase } from '../../supabase'

// =============================================
// Delphi by Amadeus — CRM Integration
// =============================================
// Delphi tracks: Accounts, Opportunities, Activities, Bookings
// We sync leads and their status changes back to Delphi automatically.
// Delphi is the dominant group sales CRM in hospitality —
// most full-service hotels use it as their primary system of record.
//
// Auth: OAuth 2.0 — access_token stored in crm_connections
// Docs: https://developer.amadeus-hospitality.com

const DELPHI_BASE_URL = 'https://api.amadeus-hospitality.com/delphi/v1'

/**
 * Fetch new opportunities from Delphi and insert as leads.
 * Pulls opportunities created or modified in the last 48 hours.
 */
export async function ingestLeads(hotelId) {
  let token
  try {
    token = await getDelphiToken(hotelId)
  } catch {
    return [] // Hotel hasn't connected Delphi — skip silently
  }

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const response = await fetch(
    `${DELPHI_BASE_URL}/opportunities?modifiedAfter=${since}&status=TENTATIVE,PROSPECT`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    }
  )

  if (!response.ok) {
    console.error('Delphi fetch failed:', await response.text())
    return []
  }

  const { opportunities } = await response.json()
  if (!opportunities?.length) return []

  const normalized = opportunities.map(opp => normalizeOpportunity(opp, hotelId))
  return await upsertLeads(normalized, hotelId)
}

function normalizeOpportunity(opp, hotelId) {
  const account = opp.account ?? {}
  const event = opp.opportunity ?? {}

  const eventTypeMap = {
    'CORPORATE': 'corporate',
    'WEDDING': 'wedding',
    'SOCIAL': 'social',
    'SPORTS': 'sports',
    'GOVERNMENT': 'government',
    'RELIGIOUS': 'religious',
    'TOUR': 'tour & travel'
  }

  return {
    hotel_id: hotelId,
    source: 'delphi',
    external_id: String(opp.id),
    external_url: `https://app.delphi.com/opportunities/${opp.id}`,
    contact_name: account.name ?? opp.contactName ?? 'Unknown',
    contact_email: account.email ?? null,
    contact_phone: account.phone ?? null,
    company: account.company ?? null,
    event_type: eventTypeMap[event.eventType] ?? 'other',
    group_size: event.roomsRequested ?? null,
    dates_requested: {
      check_in: event.checkIn ?? null,
      check_out: event.checkOut ?? null,
      flexible: false
    },
    budget_per_night: event.budgetPerNight ?? null,
    fb_budget: event.fbBudget ?? null,
    special_requests: event.notes ?? null,
    raw_content: JSON.stringify(opp),
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

  if (error) console.error('Delphi lead upsert error:', error)
  return data ?? []
}

async function getDelphiToken(hotelId) {
  const { data } = await supabase
    .from('crm_connections')
    .select('access_token, token_expires_at, refresh_token')
    .eq('hotel_id', hotelId)
    .eq('provider', 'delphi')
    .single()

  if (!data) throw new Error('No Delphi connection found for this hotel')

  // TODO: implement token refresh if expired
  return data.access_token
}

/**
 * Create or update an Opportunity in Delphi when a new lead is scored.
 */
export async function upsertDelphiOpportunity(lead, decision, hotelId) {
  const token = await getDelphiToken(hotelId)

  const payload = {
    name: `${lead.contact_name} - ${lead.event_type} ${lead.dates_requested?.check_in ?? ''}`,
    account: {
      name: lead.company || lead.contact_name,
      email: lead.contact_email,
      phone: lead.contact_phone
    },
    opportunity: {
      eventType: lead.event_type,
      checkIn: lead.dates_requested?.check_in,
      checkOut: lead.dates_requested?.check_out,
      roomsRequested: lead.group_size,
      budgetPerNight: lead.budget_per_night,
      fbBudget: lead.fb_budget,
      status: mapScoreToDelphiStatus(decision.score),
      source: lead.source,
      notes: `[HotelPlanner] Agent Score: ${decision.score.toUpperCase()}\n${decision.reasoning}`
    }
  }

  const response = await fetch(`${DELPHI_BASE_URL}/opportunities`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Delphi API error: ${err}`)
  }

  return response.json()
}

/**
 * Log an email activity in Delphi (sent or received).
 */
export async function logDelphiActivity(lead, emailThread, hotelId) {
  const token = await getDelphiToken(hotelId)

  const payload = {
    opportunityRef: lead.crm_opportunity_id,
    activity: {
      type: emailThread.direction === 'outbound' ? 'EMAIL_SENT' : 'EMAIL_RECEIVED',
      subject: emailThread.subject,
      body: emailThread.body,
      contactEmail: lead.contact_email,
      occurredAt: emailThread.received_at
    }
  }

  const response = await fetch(`${DELPHI_BASE_URL}/activities`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    console.warn('Delphi activity log failed, non-critical:', await response.text())
  }
}

/**
 * Update opportunity stage in Delphi when lead status changes.
 */
export async function updateDelphiStage(opportunityId, newStage, hotelId) {
  const token = await getDelphiToken(hotelId)

  const response = await fetch(`${DELPHI_BASE_URL}/opportunities/${opportunityId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: newStage })
  })

  if (!response.ok) {
    throw new Error(`Delphi stage update failed: ${await response.text()}`)
  }

  return response.json()
}

/**
 * Mark an opportunity as LOST in Delphi when a lead is declined.
 */
export async function declineLead(lead, hotelId) {
  if (!lead.external_id) return
  let token
  try { token = await getDelphiToken(hotelId) } catch { return }

  await fetch(`${DELPHI_BASE_URL}/opportunities/${lead.external_id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'LOST', lostReason: 'Hotel unable to accommodate — declined.' })
  })
}

function mapScoreToDelphiStatus(score) {
  const map = {
    hot: 'QUALIFIED',
    warm: 'TENTATIVE',
    cold: 'LOST'
  }
  return map[score] ?? 'TENTATIVE'
}
