-- Add batchState to Campaign
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BatchState') THEN
    CREATE TYPE "BatchState" AS ENUM ('RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED');
  END IF;
END $$;

ALTER TABLE "Campaign"
  ADD COLUMN IF NOT EXISTS "batchState" "BatchState" NOT NULL DEFAULT 'STOPPED';
