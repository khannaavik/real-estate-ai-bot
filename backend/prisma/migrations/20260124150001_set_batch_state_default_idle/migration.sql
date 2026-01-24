-- Set default batchState to IDLE
ALTER TABLE "Campaign"
  ALTER COLUMN "batchState" SET DEFAULT 'IDLE';
