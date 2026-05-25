-- Migration 006: Personal Tone
-- Adds columns to store user's email samples and the AI-generated
-- style summary used when tone_of_voice = 'personal'

ALTER TABLE hotel_profiles
  ADD COLUMN IF NOT EXISTS personal_tone_samples TEXT,
  ADD COLUMN IF NOT EXISTS personal_tone_summary  TEXT;
