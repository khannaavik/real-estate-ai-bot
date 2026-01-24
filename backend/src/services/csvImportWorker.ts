import { parse } from "csv-parse/sync";
import { prisma } from "../prisma";

type CsvCounters = {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
};

const queue: string[] = [];
let isProcessing = false;

function normalizeIndianPhone(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s|-/g, "");

  if (/^\+91\d{10}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^91\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  return null;
}

async function updateJobCounters(jobId: string, counters: CsvCounters, status?: "PROCESSING" | "COMPLETED" | "FAILED", error?: string) {
  await prisma.csvImportJob.update({
    where: { id: jobId },
    data: {
      pending: counters.pending,
      inProgress: counters.inProgress,
      completed: counters.completed,
      failed: counters.failed,
      ...(status ? { status } : {}),
      ...(error ? { error } : {}),
    },
  });
}

async function processJob(jobId: string): Promise<void> {
  const job = await prisma.csvImportJob.findUnique({
    where: { id: jobId },
  });

  if (!job) {
    return;
  }

  const counters: CsvCounters = {
    pending: 0,
    inProgress: 0,
    completed: 0,
    failed: 0,
  };

  try {
    await prisma.csvImportJob.update({
      where: { id: jobId },
      data: { status: "PROCESSING", error: null },
    });

    const records = parse(job.csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];

    counters.pending = records.length;
    await updateJobCounters(jobId, counters);

    const campaign = await prisma.campaign.findUnique({
      where: { id: job.campaignId },
    });

    if (!campaign) {
      await updateJobCounters(jobId, counters, "FAILED", "Campaign not found");
      return;
    }

    for (const row of records) {
      counters.pending -= 1;
      counters.inProgress = 1;
      await updateJobCounters(jobId, counters);

      try {
        const nameKey = Object.keys(row).find((k) => k.trim().toLowerCase() === "name") || "name";
        const phoneKey = Object.keys(row).find((k) => k.trim().toLowerCase() === "phone") || "phone";
        const name = (row[nameKey] || "").trim();
        const phoneRaw = (row[phoneKey] || "").trim();

        const phone = normalizeIndianPhone(phoneRaw);
        if (!phone) {
          counters.failed += 1;
          continue;
        }

        const existingContact = await prisma.contact.findFirst({
          where: {
            phone,
            userId: campaign.userId,
          },
          include: {
            campaigns: {
              where: { campaignId: job.campaignId },
            },
          },
        });

        if (existingContact && Array.isArray((existingContact as any).campaigns) && (existingContact as any).campaigns.length > 0) {
          counters.failed += 1;
          continue;
        }

        const contact = existingContact
          ? existingContact
          : await prisma.contact.create({
              data: {
                userId: campaign.userId,
                name: name || "Unknown",
                phone,
                source: "CSV",
              },
            });

        await prisma.campaignContact.create({
          data: {
            campaignId: job.campaignId,
            contactId: contact.id,
            status: "NOT_PICK",
            callStatus: "PENDING",
            extraContext: {
              batchStatus: "PENDING",
              batchImportedAt: new Date().toISOString(),
              source: "CSV",
            } as any,
          },
        });

        counters.completed += 1;
      } catch {
        counters.failed += 1;
      } finally {
        counters.inProgress = 0;
        await updateJobCounters(jobId, counters);
      }
    }

    await updateJobCounters(jobId, counters, "COMPLETED");
  } catch (err: any) {
    await updateJobCounters(jobId, counters, "FAILED", String(err?.message || err));
  }
}

async function processQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (queue.length > 0) {
      const jobId = queue.shift();
      if (!jobId) continue;
      try {
        await processJob(jobId);
      } catch (err) {
        console.error("[CSV WORKER] Job failed:", err);
      }
    }
  } finally {
    isProcessing = false;
  }
}

export function enqueueCsvJob(jobId: string): void {
  queue.push(jobId);
  setImmediate(() => {
    void processQueue();
  });
}
