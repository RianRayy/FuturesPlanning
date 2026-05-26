import { supabase } from '../../supabase'

// =============================================
// Cvent Integration
// =============================================
// Cvent is the dominant RFP platform for group sales.
// Meeting planners submit RFPs through Cvent Supplier
// Network and hotels respond with proposals.
//
// Auth: OAuth 2.0 client credentials (machine-to-machine)
// Hotel provides: client_id + client_secret from their
// Cvent Developer Portal → Applications
//
// All Cvent API calls run server-side via Supabase Edge
// Functions — credentials never touch the browser.
//
// Real-time: Cvent pushes new RFPs via webhook (PNS).
// The webhook URL to register in Cvent is:
//   https://{PROJECT_REF}.supabase.co/functions/v1/cvent-webhook?hotel_id={hotel_id}

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'
const ANON_KEY      = import.meta.env.VITE_SUPABASE_ANON_KEY

function headers() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ANON_KEY}`,
    'apikey': ANON_KEY
  }
}

/**
 * Pull new RFPs from Cvent and insert as leads.
 * Runs server-side — credentials stay in Supabase.
 */
export async function ingestLeads(hotelId) {
  // Check connection exists before bothering the Edge Function
  const { data: conn } = await supabase
    .from('crm_connections')
    .select('id')
    .eq('hotel_id', hotelId)
    .eq('provider', 'cvent')
    .single()

  if (!conn) return [] // Not connected — skip silently

  const res = await fetch(`${FUNCTIONS_URL}/cvent-ingest`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ hotel_id: hotelId })
  })

  if (!res.ok) {
    console.error('Cvent ingest failed:', await res.text())
    return []
  }

  const { leads = [] } = await res.json()
  return leads
}

/**
 * Submit a proposal/bid back to Cvent for an approved lead.
 * Called automatically when the user approves a Cvent lead.
 */
export async function submitProposal(lead, decision, hotelId) {
  if (!lead.external_id || lead.source !== 'cvent') return

  const res = await fetch(`${FUNCTIONS_URL}/cvent-submit-proposal`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      hotel_id:   hotelId,
      rfp_id:     lead.external_id,
      rate:       lead.budget_per_night,
      email_body: decision.draft_body
    })
  })

  if (!res.ok) {
    console.error('Cvent proposal submission failed:', await res.text())
  }
}

/**
 * Pass on / decline an RFP — notifies Cvent so the planner
 * knows to move on. Non-critical if this fails.
 */
export async function declineLead(lead, hotelId) {
  if (!lead.external_id || lead.source !== 'cvent') return

  const res = await fetch(`${FUNCTIONS_URL}/cvent-decline`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      hotel_id: hotelId,
      rfp_id:   lead.external_id
    })
  })

  if (!res.ok) {
    console.warn('Cvent decline notification failed (non-critical):', await res.text())
  }
}
