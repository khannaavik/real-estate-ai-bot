-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('STARTED', 'PICKED', 'NO_ANSWER', 'COMPLETED');

-- CreateEnum
CREATE TYPE "InterestLevel" AS ENUM ('COLD', 'WARM', 'HOT');

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL,
    "durationSec" INTEGER,
    "interestLevel" "InterestLevel",
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);
