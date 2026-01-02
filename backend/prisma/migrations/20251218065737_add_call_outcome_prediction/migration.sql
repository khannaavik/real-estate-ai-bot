-- AlterTable
ALTER TABLE "CallLog" ADD COLUMN     "outcomeAction" TEXT,
ADD COLUMN     "outcomeBucket" TEXT,
ADD COLUMN     "outcomeConfidence" TEXT,
ADD COLUMN     "outcomeFollowUp" TEXT,
ADD COLUMN     "outcomeProbability" INTEGER;
