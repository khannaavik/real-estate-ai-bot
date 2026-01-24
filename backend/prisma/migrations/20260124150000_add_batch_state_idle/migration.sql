-- Add IDLE to BatchState enum and update default
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'IDLE'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'BatchState')
  ) THEN
    ALTER TYPE "BatchState" ADD VALUE 'IDLE';
  END IF;
END $$;

