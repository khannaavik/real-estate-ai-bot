/*
  Warnings:

  - Added the required column `updatedAt` to the `Campaign` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_propertyId_fkey";

-- AlterTable
-- Step 1: Add updatedAt as nullable first
ALTER TABLE "Campaign" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- Step 2: Update existing rows with current timestamp
UPDATE "Campaign" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;

-- Step 3: Make updatedAt NOT NULL
ALTER TABLE "Campaign" ALTER COLUMN "updatedAt" SET NOT NULL;

-- Step 4: Make propertyId nullable
ALTER TABLE "Campaign" ALTER COLUMN "propertyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BatchCallJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "totalLeads" INTEGER NOT NULL,
    "cooldownHours" INTEGER NOT NULL,
    "maxRetries" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchCallJob_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchCallJob" ADD CONSTRAINT "BatchCallJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
