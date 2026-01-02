-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "callerDisplayName" TEXT,
ADD COLUMN     "callerIdentityMode" TEXT DEFAULT 'GENERIC';
