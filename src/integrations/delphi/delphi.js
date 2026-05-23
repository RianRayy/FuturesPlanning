import { supabase } from '../../supabase'

// =============================================
// Delphi by Amadeus — CRM Integration
// =============================================
// Delphi tracks: Accounts, Opportunities, Activities, Bookings
// We sync leads and their status changes back to Delphi automatically.

const DELPHI_BASE_URL = 'https://api.amadeus-hospitality.com/delphi/v1'

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

function mapScoreToDelphiStatus(score) {
  const map = {
    hot: 'QUALIFIED',
    warm: 'TENTATIVE',
    cold: 'LOST'
  }
  return map[score] ?? 'TENTATIVE'
}
