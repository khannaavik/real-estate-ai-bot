-- Add callResult to CampaignContact for structured outcomes
ALTER TABLE "CampaignContact"
  ADD COLUMN IF NOT EXISTS "callResult" JSONB;
