-- Update BatchCallJob schema for batch calling foundation
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BatchCallStatus') THEN
    CREATE TYPE "BatchCallStatus" AS ENUM ('QUEUED', 'RUNNING', 'STOPPED', 'COMPLETED');
  END IF;
END $$;

ALTER TABLE "BatchCallJob"
  ADD COLUMN IF NOT EXISTS "pending" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "inProgress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "completed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stoppedAt" TIMESTAMP(3);

ALTER TABLE "BatchCallJob"
  DROP COLUMN IF EXISTS "currentIndex",
  DROP COLUMN IF EXISTS "totalLeads",
  DROP COLUMN IF EXISTS "cooldownHours",
  DROP COLUMN IF EXISTS "maxRetries",
  DROP COLUMN IF EXISTS "pausedAt",
  DROP COLUMN IF EXISTS "completedAt",
  DROP COLUMN IF EXISTS "cancelledAt",
  DROP COLUMN IF EXISTS "cancelledBy",
  DROP COLUMN IF EXISTS "updatedAt";

ALTER TABLE "BatchCallJob"
  ALTER COLUMN "status" TYPE "BatchCallStatus" USING (
    CASE
      WHEN "status"::text = 'RUNNING' THEN 'RUNNING'::"BatchCallStatus"
      WHEN "status"::text = 'COMPLETED' THEN 'COMPLETED'::"BatchCallStatus"
      WHEN "status"::text = 'PAUSED' THEN 'STOPPED'::"BatchCallStatus"
      WHEN "status"::text = 'CANCELLED' THEN 'STOPPED'::"BatchCallStatus"
      WHEN "status"::text = 'PENDING' THEN 'QUEUED'::"BatchCallStatus"
      ELSE 'STOPPED'::"BatchCallStatus"
    END
  ),
  ALTER COLUMN "status" SET DEFAULT 'QUEUED';
