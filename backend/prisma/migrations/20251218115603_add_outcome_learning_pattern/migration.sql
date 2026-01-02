-- CreateTable
CREATE TABLE "OutcomeLearningPattern" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "scriptVariant" TEXT,
    "voiceTone" TEXT,
    "emotion" TEXT,
    "urgencyLevel" TEXT,
    "objections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcomeBucket" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeLearningPattern_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OutcomeLearningPattern" ADD CONSTRAINT "OutcomeLearningPattern_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
