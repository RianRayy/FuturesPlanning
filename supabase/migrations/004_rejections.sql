-- =============================================
-- Migration 004: Lead Rejections
-- Adds rejection tracking to lead_decisions.
-- Auto-rejections: agent detects hard criteria
-- failures (capacity exceeded, dates blocked, etc.)
-- Manual declines: sales rep declines any lead.
-- =============================================

ALTER TABLE lead_decisions
  ADD COLUMN IF NOT EXISTS auto_rejected        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rejection_reason     TEXT,       -- short reason shown on dashboard
  ADD COLUMN IF NOT EXISTS rejection_draft_subject TEXT,   -- pre-drafted decline email
  ADD COLUMN IF NOT EXISTS rejection_draft_body    TEXT,
  ADD COLUMN IF NOT EXISTS declined_at          TIMESTAMPTZ; -- set when decline email is sent

-- Also relax the score constraint so auto-rejected leads
-- can have a null score (they were never scored)
ALTER TABLE lead_decisions
  DROP CONSTRAINT IF EXISTS lead_decisions_score_check;

ALTER TABLE lead_decisions
  ADD CONSTRAINT lead_decisions_score_check
  CHECK (score IN ('hot', 'warm', 'cold') OR score IS NULL);
