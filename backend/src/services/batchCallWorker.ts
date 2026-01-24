import { BatchCallStatus } from "@prisma/client";
import { prisma } from "../prisma";

export async function runBatchCallWorker(batchId: string): Promise<void> {
  try {
    const job = await prisma.batchCallJob.findUnique({
      where: { id: batchId },
      select: { id: true, status: true },
    });

    if (!job || job.status !== BatchCallStatus.QUEUED) {
      return;
    }

    await prisma.batchCallJob.update({
      where: { id: batchId },
      data: {
        status: BatchCallStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    console.log(`[BATCH] Batch ${batchId} running (stub mode)`);
  } catch (err) {
    console.error(`[BATCH] Batch ${batchId} failed to start (stub)`, err);
  }
}
