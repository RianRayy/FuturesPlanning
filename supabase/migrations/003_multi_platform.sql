-- =============================================
-- Migration 003: Multi-Platform Lead Ingestion
-- Each lead now tracks which platform it came
-- from and its ID in that platform's system.
-- =============================================

-- Add external reference columns to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS external_id   TEXT,     -- the record's ID in the source platform
  ADD COLUMN IF NOT EXISTS external_url  TEXT;     -- deep link back to the record in the platform

-- Prevent duplicate ingestion: same hotel can't have
-- two leads with the same source + external_id
CREATE UNIQUE INDEX IF NOT EXISTS leads_source_external_id_unique
  ON leads (hotel_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- Update the source column comment to list all supported platforms
COMMENT ON COLUMN leads.source IS
  'Platform the lead originated from: email | delphi | salesforce | hubspot | cvent | hotelplanner | manual';
