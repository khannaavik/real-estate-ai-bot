-- Rename existing call status enum to preserve data
ALTER TYPE "CallStatus" RENAME TO "CallLifecycleStatus";

-- Create new lead call status enum
CREATE TYPE "CallStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- Add batchActive to campaigns
ALTER TABLE "Campaign" ADD COLUMN "batchActive" BOOLEAN NOT NULL DEFAULT false;

-- Add callStatus + createdAt to campaign contacts
ALTER TABLE "CampaignContact" ADD COLUMN "callStatus" "CallStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "CampaignContact" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Indexes for fast lookup
CREATE INDEX "Campaign_batchActive_idx" ON "Campaign"("batchActive");
CREATE INDEX "CampaignContact_campaignId_callStatus_createdAt_idx" ON "CampaignContact"("campaignId", "callStatus", "createdAt");
