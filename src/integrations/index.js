// =============================================
// MULTI-PLATFORM LEAD INGESTION
// =============================================
// This is the single entry point for pulling leads
// from every connected platform into FuturesPlanning.
//
// Supported platforms:
//   - Delphi by Amadeus  (most common hospitality CRM)
//   - Salesforce         (enterprise hotels)
//   - HubSpot            (mid-market hotels)
//   - Cvent              (RFP / meeting planner marketplace)
//   - HotelPlanner.com   (group booking marketplace)
//
// Each adapter handles its own auth check — if a hotel
// hasn't connected a platform, that adapter silently
// returns [] and ingestion continues for the rest.
//
// All leads are normalized to the same schema before
// being inserted, so the scoring agent treats them
// identically regardless of source. The best leads
// rise to the top of the dashboard across ALL platforms.

import { ingestLeads as ingestDelphi, declineLead as declineDelphi }               from './delphi/delphi'
import { ingestLeads as ingestSalesforce, declineLead as declineSalesforce }       from './salesforce/salesforce'
import { ingestLeads as ingestHubSpot, declineLead as declineHubSpot }             from './hubspot/hubspot'
import { ingestLeads as ingestCvent, declineLead as declineCvent }                 from './cvent/cvent'
import { ingestLeads as ingestHotelPlanner, declineLead as declineHotelPlanner }   from './hotelplanner/hotelplanner'

// Platform display metadata — used in UI badges and logs
export const PLATFORM_CONFIG = {
  delphi: {
    label: 'Delphi',
    color: '#7c3aed',   // purple
    bg: '#1e1040',
    logo: 'D'
  },
  salesforce: {
    label: 'Salesforce',
    color: '#0ea5e9',   // blue
    bg: '#0c2340',
    logo: 'SF'
  },
  hubspot: {
    label: 'HubSpot',
    color: '#f97316',   // orange
    bg: '#2d1500',
    logo: 'HS'
  },
  cvent: {
    label: 'Cvent',
    color: '#10b981',   // teal
    bg: '#052e1c',
    logo: 'CV'
  },
  hotelplanner: {
    label: 'HotelPlanner',
    color: '#4f7ef8',   // brand blue
    bg: '#0d1f4c',
    logo: 'HP'
  },
  email: {
    label: 'Email',
    color: '#94a3b8',   // slate
    bg: '#1a1d27',
    logo: '✉'
  },
  manual: {
    label: 'Manual',
    color: '#64748b',
    bg: '#1a1d27',
    logo: 'M'
  }
}

/**
 * Pull new leads from every platform this hotel has connected.
 * Runs all ingestion in parallel — each platform is independent.
 * Returns a summary of how many leads came in from each source.
 */
export async function ingestAllPlatforms(hotelId) {
  const results = await Promise.allSettled([
    ingestDelphi(hotelId).then(leads => ({ source: 'delphi', count: leads.length })),
    ingestSalesforce(hotelId).then(leads => ({ source: 'salesforce', count: leads.length })),
    ingestHubSpot(hotelId).then(leads => ({ source: 'hubspot', count: leads.length })),
    ingestCvent(hotelId).then(leads => ({ source: 'cvent', count: leads.length })),
    ingestHotelPlanner(hotelId).then(leads => ({ source: 'hotelplanner', count: leads.length }))
  ])

  const summary = {}
  let totalNew = 0

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { source, count } = result.value
      if (count > 0) {
        summary[source] = count
        totalNew += count
      }
    } else {
      console.error('Platform ingestion error:', result.reason)
    }
  }

  if (totalNew > 0) {
    console.log(`[FuturesPlanning] Ingested ${totalNew} new leads:`, summary)
  }

  return { totalNew, bySource: summary }
}

/**
 * Notify the originating platform that a lead has been declined.
 * Routes to the correct adapter based on lead.source.
 * Non-critical — failure is caught and logged by the caller.
 */
export async function declineOnPlatform(lead, hotelId) {
  const declineMap = {
    delphi:       declineDelphi,
    salesforce:   declineSalesforce,
    hubspot:      declineHubSpot,
    cvent:        declineCvent,
    hotelplanner: declineHotelPlanner
  }

  const fn = declineMap[lead.source]
  if (fn) {
    await fn(lead, hotelId)
  }
  // email/manual leads have no external platform to notify — that's fine
}
