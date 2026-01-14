-- Remove foreign key constraints
ALTER TABLE "Campaign" DROP CONSTRAINT IF EXISTS "Campaign_userId_fkey";
ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_userId_fkey";

-- Drop User table (if no other dependencies)
DROP TABLE IF EXISTS "User";
