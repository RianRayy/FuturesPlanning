import { supabase } from '../../supabase'

// =============================================
// Salesforce CRM Integration
// =============================================
// Uses Salesforce REST API with OAuth 2.0.
// Hotels using Salesforce typically track group
// sales leads as Leads or Opportunities depending
// on their sales process setup.

/**
 * Fetch new leads from Salesforce and insert into our system.
 * Queries Lead objects created or modified in the last 48 hours.
 */
export async function ingestLeads(hotelId) {
  let token, instanceUrl
  try {
    const creds = await getSalesforceToken(hotelId)
    token = creds.token
    instanceUrl = creds.instanceUrl
  } catch {
    return [] // Hotel hasn't connected Salesforce — skip silently
  }

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const soql = encodeURIComponent(
    `SELECT Id, FirstName, LastName, Email, Phone, Company, LeadSource, ` +
    `HotelPlanner_Event_Type__c, HotelPlanner_Group_Size__c, ` +
    `HotelPlanner_Check_In__c, HotelPlanner_Check_Out__c, ` +
    `HotelPlanner_Budget__c, Description, CreatedDate ` +
    `FROM Lead ` +
    `WHERE SystemModstamp >= ${since} AND IsConverted = false`
  )

  const response = await fetch(
    `${instanceUrl}/services/data/v57.0/query?q=${soql}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!response.ok) {
    console.error('Salesforce fetch failed:', await response.text())
    return []
  }

  const { records } = await response.json()
  if (!records?.length) return []

  const normalized = records.map(rec => normalizeLead(rec, hotelId, instanceUrl))
  return await upsertLeads(normalized, hotelId)
}

function normalizeLead(rec, hotelId, instanceUrl) {
  return {
    hotel_id: hotelId,
    source: 'salesforce',
    external_id: rec.Id,
    external_url: `${instanceUrl}/lightning/r/Lead/${rec.Id}/view`,
    contact_name: `${rec.FirstName ?? ''} ${rec.LastName ?? ''}`.trim() || 'Unknown',
    contact_email: rec.Email ?? null,
    contact_phone: rec.Phone ?? null,
    company: rec.Company ?? null,
    event_type: rec.HotelPlanner_Event_Type__c ?? 'other',
    group_size: rec.HotelPlanner_Group_Size__c ? parseInt(rec.HotelPlanner_Group_Size__c) : null,
    dates_requested: {
      check_in: rec.HotelPlanner_Check_In__c ?? null,
      check_out: rec.HotelPlanner_Check_Out__c ?? null,
      flexible: false
    },
    budget_per_night: rec.HotelPlanner_Budget__c ? parseFloat(rec.HotelPlanner_Budget__c) : null,
    special_requests: rec.Description ?? null,
    raw_content: JSON.stringify(rec),
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

  if (error) console.error('Salesforce lead upsert error:', error)
  return data ?? []
}

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

/**
 * Mark a Lead as Closed - Not Converted in Salesforce when declined.
 */
export async function declineLead(lead, hotelId) {
  if (!lead.external_id) return
  let token, instanceUrl
  try {
    const creds = await getSalesforceToken(hotelId)
    token = creds.token
    instanceUrl = creds.instanceUrl
  } catch { return }

  await fetch(`${instanceUrl}/services/data/v57.0/sobjects/Lead/${lead.external_id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Status: 'Closed - Not Converted', Description: 'Declined by hotel — unable to accommodate.' })
  })
}

function mapScoreToSFStatus(score) {
  const map = {
    hot: 'Working - Contacted',
    warm: 'Open - Not Contacted',
    cold: 'Closed - Not Converted'
  }
  return map[score] ?? 'Open - Not Contacted'
}
