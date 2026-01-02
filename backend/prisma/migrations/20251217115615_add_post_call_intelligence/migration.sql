-- AlterTable
ALTER TABLE "CallLog" ADD COLUMN     "postCallBestCallbackTime" TEXT,
ADD COLUMN     "postCallInterestLevel" TEXT,
ADD COLUMN     "postCallNextAction" TEXT,
ADD COLUMN     "postCallObjections" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "postCallSummary" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "CampaignContact" ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "followUpAfterHours" INTEGER,
ADD COLUMN     "followUpChannel" TEXT,
ADD COLUMN     "followUpMessageIntent" TEXT,
ADD COLUMN     "followUpPlannedAt" TIMESTAMP(3),
ADD COLUMN     "handoffReason" TEXT,
ADD COLUMN     "handoffRecommended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isConverted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastQuestionsAsked" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "objections" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "preferredLanguage" TEXT,
ADD COLUMN     "sentimentTrend" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AILearningPattern" (
    "id" TEXT NOT NULL,
    "campaignContactId" TEXT NOT NULL,
    "callLogId" TEXT,
    "transcriptPattern" JSONB,
    "objectionResolutionSequence" JSONB,
    "conversationFlow" JSONB,
    "initialStatus" "LeadStatus",
    "finalStatus" "LeadStatus",
    "questionsAsked" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objectionsRaised" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentimentProgression" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversionDate" TIMESTAMP(3),

    CONSTRAINT "AILearningPattern_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AILearningPattern" ADD CONSTRAINT "AILearningPattern_campaignContactId_fkey" FOREIGN KEY ("campaignContactId") REFERENCES "CampaignContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILearningPattern" ADD CONSTRAINT "AILearningPattern_callLogId_fkey" FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
