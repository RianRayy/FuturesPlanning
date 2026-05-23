-- =============================================
-- HotelPlanner Initial Schema
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- HOTELS (one row per hotel tenant)
-- =============================================
CREATE TABLE hotels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  subdomain TEXT UNIQUE NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- HOTEL PROFILES (capacity, rates, preferences)
-- =============================================
CREATE TABLE hotel_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE UNIQUE,
  room_count INTEGER,
  rate_min NUMERIC(10,2),
  rate_max NUMERIC(10,2),
  min_group_size INTEGER DEFAULT 10,
  target_segments TEXT[] DEFAULT '{}',  -- corporate, wedding, social, sports, etc.
  event_spaces JSONB DEFAULT '[]',      -- [{name, capacity, sqft}]
  fb_minimum NUMERIC(10,2),             -- minimum F&B spend for event bookings
  tone_of_voice TEXT DEFAULT 'professional', -- professional | warm | luxury
  hotel_description TEXT,               -- used to personalize agent emails
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- HOTEL USERS (staff with access)
-- =============================================
CREATE TABLE hotel_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'rep' CHECK (role IN ('admin', 'manager', 'rep')),
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_id, user_id)
);

-- =============================================
-- AVAILABILITY (blocked/open dates)
-- =============================================
CREATE TABLE availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  rooms_available INTEGER,
  is_blocked BOOLEAN DEFAULT FALSE,
  notes TEXT,
  UNIQUE(hotel_id, date)
);

-- =============================================
-- LEADS (every inbound inquiry)
-- =============================================
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'email',          -- email | delphi | cvent | manual
  raw_content TEXT,                     -- original email or RFP body
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  company TEXT,
  event_type TEXT,                      -- corporate | wedding | social | sports | other
  group_size INTEGER,
  dates_requested JSONB,                -- {check_in, check_out, flexible: bool}
  budget_per_night NUMERIC(10,2),
  fb_budget NUMERIC(10,2),
  special_requests TEXT,
  status TEXT DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'processed', 'archived')
  ),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- LEAD DECISIONS (agent output per lead)
-- =============================================
CREATE TABLE lead_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE UNIQUE,
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  score TEXT CHECK (score IN ('hot', 'warm', 'cold')),
  reasoning TEXT,                       -- 1-2 sentence explanation shown on dashboard
  draft_subject TEXT,
  draft_body TEXT,                      -- initial outbound email draft
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- EMAIL THREADS (all messages per lead)
-- =============================================
CREATE TABLE email_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  direction TEXT CHECK (direction IN ('outbound', 'inbound')),
  subject TEXT,
  body TEXT,
  from_address TEXT,
  to_address TEXT,
  sendgrid_message_id TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- FOLLOW UP QUEUE (scheduled follow-ups)
-- =============================================
CREATE TABLE follow_up_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  sequence_day INTEGER,                 -- 3, 7, or 14
  draft_subject TEXT,
  draft_body TEXT,
  scheduled_for DATE,
  status TEXT DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'sent', 'cancelled')
  ),
  approved_by UUID REFERENCES auth.users(id),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- REPLY DRAFTS (agent response to inbound emails)
-- =============================================
CREATE TABLE reply_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  in_reply_to UUID REFERENCES email_threads(id),
  reply_type TEXT,                      -- pricing_question | site_visit | alternate_dates | decline | general
  draft_subject TEXT,
  draft_body TEXT,
  status TEXT DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'sent', 'discarded')
  ),
  approved_by UUID REFERENCES auth.users(id),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- CRM CONNECTIONS (Delphi, Salesforce, etc.)
-- =============================================
CREATE TABLE crm_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  provider TEXT CHECK (provider IN ('delphi', 'salesforce', 'hubspot')),
  access_token TEXT,                    -- encrypted at app layer before storing
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  config JSONB DEFAULT '{}',            -- provider-specific config
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_id, provider)
);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE reply_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_connections ENABLE ROW LEVEL SECURITY;

-- Helper function: get the hotel_id for the currently logged-in user
CREATE OR REPLACE FUNCTION get_user_hotel_id()
RETURNS UUID AS $$
  SELECT hotel_id FROM hotel_users WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Hotels: users can only see their own hotel
CREATE POLICY "hotel_isolation" ON hotels
  FOR ALL USING (id = get_user_hotel_id());

-- All other tables: scoped to hotel_id
CREATE POLICY "hotel_profiles_isolation" ON hotel_profiles
  FOR ALL USING (hotel_id = get_user_hotel_id());

CREATE POLICY "hotel_users_isolation" ON hotel_users
  FOR ALL USING (hotel_id = get_user_hotel_id());

CREATE POLICY "availability_isolation" ON availability
  FOR ALL USING (hotel_id = get_user_hotel_id());

CREATE POLICY "leads_isolation" ON leads
  FOR ALL USING (hotel_id = get_user_hotel_id());

CREATE POLICY "lead_decisions_isolation" ON lead_decisions
  FOR ALL USING (hotel_id = get_user_hotel_id());

CREATE POLICY "email_threads_isolation" ON email_threads
  FOR ALL USING (hotel_id = get_user_hotel_id());

CREATE POLICY "follow_up_queue_isolation" ON follow_up_queue
  FOR ALL USING (hotel_id = get_user_hotel_id());

CREATE POLICY "reply_drafts_isolation" ON reply_drafts
  FOR ALL USING (hotel_id = get_user_hotel_id());

CREATE POLICY "crm_connections_isolation" ON crm_connections
  FOR ALL USING (hotel_id = get_user_hotel_id());
