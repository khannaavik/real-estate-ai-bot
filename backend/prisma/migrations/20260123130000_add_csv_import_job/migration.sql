-- CreateEnum
CREATE TYPE "CsvImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "CsvImportJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" "CsvImportStatus" NOT NULL DEFAULT 'QUEUED',
    "csvData" TEXT NOT NULL,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "inProgress" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsvImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CsvImportJob_campaignId_createdAt_idx" ON "CsvImportJob"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "CsvImportJob_status_idx" ON "CsvImportJob"("status");

-- AddForeignKey
ALTER TABLE "CsvImportJob" ADD CONSTRAINT "CsvImportJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
