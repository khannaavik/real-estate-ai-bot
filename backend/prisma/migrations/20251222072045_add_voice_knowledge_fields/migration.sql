-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "knowledgeUsageMode" TEXT DEFAULT 'INTERNAL_ONLY',
ADD COLUMN     "voiceKnowledge" JSONB,
ADD COLUMN     "voiceTranscript" TEXT,
ADD COLUMN     "voiceTranscriptLanguage" TEXT;
