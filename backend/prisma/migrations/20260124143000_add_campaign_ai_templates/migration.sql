-- Add campaign-level AI conversation templates
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignTone') THEN
    CREATE TYPE "CampaignTone" AS ENUM ('FORMAL', 'FRIENDLY', 'ASSERTIVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignLanguage') THEN
    CREATE TYPE "CampaignLanguage" AS ENUM ('EN');
  END IF;
END $$;

ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "openingScript" TEXT,
  ADD COLUMN IF NOT EXISTS "tone" "CampaignTone" NOT NULL DEFAULT 'FRIENDLY',
  ADD COLUMN IF NOT EXISTS "language" "CampaignLanguage" NOT NULL DEFAULT 'EN';
