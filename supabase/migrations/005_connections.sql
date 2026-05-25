-- =============================================
-- Migration 005: Platform Connections
-- Expands crm_connections to support all
-- platforms. Adds setup_dismissed flag to
-- hotel_users so we know if they've seen
-- the connect-platforms onboarding modal.
-- =============================================

-- Expand provider list
ALTER TABLE crm_connections
  DROP CONSTRAINT IF EXISTS crm_connections_provider_check;

ALTER TABLE crm_connections
  ADD CONSTRAINT crm_connections_provider_check
  CHECK (provider IN (
    'delphi', 'salesforce', 'hubspot', 'cvent',
    'hotelplanner', 'opera', 'gmail', 'outlook'
  ));

-- Track whether user has dismissed the connect-platforms modal
ALTER TABLE hotel_users
  ADD COLUMN IF NOT EXISTS setup_dismissed BOOLEAN DEFAULT FALSE;
