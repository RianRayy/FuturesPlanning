import { supabase } from '../../supabase'

// =============================================
// Salesforce CRM Integration
// =============================================
// Uses Salesforce REST API with OAuth 2.0

async function getSalesforceToken(hotelId) {
  const { data } = await supabase
    .from('crm_connections')
    .select('access_token, token_expires_at, refresh_token, config')
    .eq('hotel_id', hotelId)
    .eq('provider', 'salesforce')
    .single()

  if (!data) throw new Error('No Salesforce connection found for this hotel')

  // TODO: implement token refresh if expired
  const instanceUrl = data.config?.instance_url
  return { token: data.access_token, instanceUrl }
}

/**
 * Create or update a Lead record in Salesforce.
 */
export async function upsertSalesforceLead(lead, decision, hotelId) {
  const { token, instanceUrl } = await getSalesforceToken(hotelId)

  const payload = {
    FirstName: lead.contact_name?.split(' ')[0] ?? '',
    LastName: lead.contact_name?.split(' ').slice(1).join(' ') || lead.contact_name,
    Email: lead.contact_email,
    Phone: lead.contact_phone,
    Company: lead.company || lead.contact_name,
    LeadSource: lead.source === 'email' ? 'Email' : 'Web',
    Status: mapScoreToSFStatus(decision.score),
    Description: `Event: ${lead.event_type} | Rooms: ${lead.group_size} | Dates: ${JSON.stringify(lead.dates_requested)}\n\n[HotelPlanner] ${decision.reasoning}`,
    // Custom fields — hotel will need to create these in their Salesforce
    HotelPlanner_Score__c: decision.score,
    HotelPlanner_Event_Type__c: lead.event_type,
    HotelPlanner_Check_In__c: lead.dates_requested?.check_in,
    HotelPlanner_Check_Out__c: lead.dates_requested?.check_out,
    HotelPlanner_Group_Size__c: lead.group_size,
    HotelPlanner_Budget__c: lead.budget_per_night
  }

  const response = await fetch(`${instanceUrl}/services/data/v57.0/sobjects/Lead`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Salesforce API error: ${err}`)
  }

  return response.json()
}

/**
 * Log email activity as a Task in Salesforce.
 */
export async function logSalesforceActivity(lead, emailThread, hotelId) {
  const { token, instanceUrl } = await getSalesforceToken(hotelId)

  const payload = {
    Subject: emailThread.subject,
    Description: emailThread.body,
    ActivityDate: new Date().toISOString().split('T')[0],
    Status: 'Completed',
    WhoId: lead.crm_contact_id
  }

  const response = await fetch(`${instanceUrl}/services/data/v57.0/sobjects/Task`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    console.warn('Salesforce activity log failed, non-critical:', await response.text())
  }
}

function mapScoreToSFStatus(score) {
  const map = {
    hot: 'Working - Contacted',
    warm: 'Open - Not Contacted',
    cold: 'Closed - Not Converted'
  }
  return map[score] ?? 'Open - Not Contacted'
}
