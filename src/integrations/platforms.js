// =============================================
// PLATFORM DIRECTORY
// Single source of truth for every platform
// FuturesPlanning can connect to.
// =============================================

export const PLATFORMS = [
  {
    id: 'delphi',
    name: 'Delphi',
    by: 'by Amadeus',
    description: 'The most widely used group sales CRM in hospitality',
    color: '#7c3aed',
    bg: '#1e1040',
    authType: 'oauth',
    authUrl: 'https://auth.amadeus-hospitality.com/oauth/authorize',
    logo: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#7c3aed"/>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="16" font-weight="700" font-family="sans-serif">D</text>
    </svg>`
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    by: 'CRM',
    description: 'Enterprise CRM used by large hotel groups and chains',
    color: '#0ea5e9',
    bg: '#0c2340',
    authType: 'oauth',
    authUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    logo: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#0ea5e9"/>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="13" font-weight="700" font-family="sans-serif">SF</text>
    </svg>`
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    by: 'CRM',
    description: 'Popular CRM for mid-market hotels and independent properties',
    color: '#f97316',
    bg: '#2d1500',
    authType: 'apikey',
    fields: [
      { key: 'api_key', label: 'Service Key', type: 'password', hint: 'From HubSpot → Development → Service Keys' }
    ],
    logo: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#f97316"/>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="12" font-weight="700" font-family="sans-serif">HS</text>
    </svg>`
  },
  {
    id: 'cvent',
    name: 'Cvent',
    by: 'Event Management',
    description: 'Leading RFP platform — meeting planners send inquiries here',
    color: '#10b981',
    bg: '#052e1c',
    authType: 'apikey',
    fields: [
      { key: 'client_id',     label: 'Client ID',     type: 'text',     hint: 'From Cvent Developer Portal → Applications' },
      { key: 'client_secret', label: 'Client Secret', type: 'password', hint: 'From Cvent Developer Portal → Applications' }
    ],
    logo: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#10b981"/>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="13" font-weight="700" font-family="sans-serif">CV</text>
    </svg>`
  },
  {
    id: 'hotelplanner',
    name: 'HotelPlanner',
    by: 'Group Booking',
    description: 'High-volume group booking marketplace for hotels',
    color: '#4f7ef8',
    bg: '#0d1f4c',
    authType: 'apikey',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password' },
      { key: 'hotel_property_id', label: 'Property ID', type: 'text' }
    ],
    logo: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#4f7ef8"/>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="12" font-weight="700" font-family="sans-serif">HP</text>
    </svg>`
  },
  {
    id: 'opera',
    name: 'Opera',
    by: 'by Oracle',
    description: 'Property Management System used by major hotel brands',
    color: '#dc2626',
    bg: '#2d0a0a',
    authType: 'apikey',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password' },
      { key: 'property_code', label: 'Property Code', type: 'text' },
      { key: 'environment', label: 'Environment', type: 'select', options: ['production', 'sandbox'] }
    ],
    logo: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#dc2626"/>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="12" font-weight="700" font-family="sans-serif">OP</text>
    </svg>`
  },
  {
    id: 'gmail',
    name: 'Gmail',
    by: 'Google',
    description: 'Send approved emails directly from your Gmail account',
    color: '#ef4444',
    bg: '#2d0a0a',
    authType: 'oauth',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    logo: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#ef4444"/>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="11" font-weight="700" font-family="sans-serif">Gmail</text>
    </svg>`
  },
  {
    id: 'outlook',
    name: 'Outlook',
    by: 'Microsoft',
    description: 'Send approved emails directly from your Outlook account',
    color: '#0078d4',
    bg: '#001830',
    authType: 'oauth',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    logo: `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#0078d4"/>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="11" font-weight="700" font-family="sans-serif">OL</text>
    </svg>`
  }
]
