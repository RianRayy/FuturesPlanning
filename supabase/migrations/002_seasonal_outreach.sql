-- =============================================
-- Seasonal Re-engagement Schema
-- =============================================

-- Track outreach eligibility on leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS outcome TEXT DEFAULT 'pending'
  CHECK (outcome IN ('booked', 'lost_to_competitor', 'declined_by_hotel', 'no_response', 'pending'));

ALTER TABLE leads ADD COLUMN IF NOT EXISTS repeat_eligible BOOLEAN DEFAULT TRUE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT;

-- Seasonal outreach queue
CREATE TABLE seasonal_outreach (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID REFERENCES hotels(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  season_year INTEGER NOT NULL,
  potential_score NUMERIC(3,2),        -- 0.00 to 1.00
  score_label TEXT CHECK (score_label IN ('high', 'medium', 'low')),
  reasoning TEXT,
  repeat_signals JSONB DEFAULT '[]',   -- factors that boosted the score
  draft_subject TEXT,
  draft_body TEXT,
  outreach_window_start DATE,
  outreach_window_end DATE,
  status TEXT DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'sent', 'dismissed')
  ),
  approved_by UUID REFERENCES auth.users(id),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE seasonal_outreach ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seasonal_outreach_isolation" ON seasonal_outreach
  FOR ALL USING (hotel_id = get_user_hotel_id());

CREATE POLICY "seasonal_outreach_insert" ON seasonal_outreach
  FOR INSERT WITH CHECK (hotel_id = get_user_hotel_id());
