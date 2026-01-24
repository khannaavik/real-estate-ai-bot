import { prisma } from "../prisma";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetweenMs(minSeconds: number, maxSeconds: number): number {
  const minMs = minSeconds * 1000;
  const maxMs = maxSeconds * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function randomBetweenSeconds(minSeconds: number, maxSeconds: number): number {
  return Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
}

const activeDryRunBatches = new Set<string>();

type DryRunResult = "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED";

export async function startDryRunCallWorker(campaignId: string): Promise<void> {
  if (activeDryRunBatches.has(campaignId)) return;
  activeDryRunBatches.add(campaignId);

  try {
    console.log(`[DRY-RUN] Batch started ${campaignId}`);

    const contacts = await prisma.campaignContact.findMany({
      where: { campaignId, callStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        contact: { select: { phone: true } },
      },
    });

    if (contacts.length === 0) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { batchActive: false },
      });
      console.log(`[DRY-RUN] Batch completed ${campaignId}`);
      return;
    }

    for (const contact of contacts) {
      try {
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { batchActive: true },
        });

        if (!campaign?.batchActive) {
          break;
        }

        await prisma.campaignContact.update({
          where: { id: contact.id },
          data: { callStatus: "IN_PROGRESS" },
        });

        console.log(`[DRY-RUN] Calling contact ${contact.contact?.phone || contact.id}`);

        await sleep(randomBetweenMs(1, 3));

        const roll = Math.random();
        const result: DryRunResult =
          roll < 0.6
            ? "COMPLETED"
            : roll < 0.8
            ? "NO_ANSWER"
            : roll < 0.9
            ? "BUSY"
            : "FAILED";

        const endedAt = new Date();
        const durationSeconds =
          result === "COMPLETED" ? randomBetweenSeconds(30, 180) : 0;

        const interestLevels = ["HOT", "WARM", "COLD"] as const;
        const interestLevel =
          result === "COMPLETED"
            ? interestLevels[Math.floor(Math.random() * interestLevels.length)]
            : null;

        const transcript =
          result === "COMPLETED"
            ? "Dry run transcript: simulated customer conversation."
            : null;

        const aiSummary =
          result === "COMPLETED"
            ? "Dry run completed successfully"
            : `Dry run result: ${result}`;

        const callLogData: {
          campaignContactId: string;
          startedAt: Date;
          endedAt: Date;
          durationSeconds: number | null;
          transcript: string | null;
          aiSummary: string;
          resultStatus?: "HOT" | "WARM" | "COLD";
        } = {
          campaignContactId: contact.id,
          startedAt: new Date(endedAt.getTime() - durationSeconds * 1000),
          endedAt,
          durationSeconds: durationSeconds || null,
          transcript,
          aiSummary,
        };

        if (interestLevel) {
          callLogData.resultStatus = interestLevel;
        }

        const callLog = await prisma.callLog.create({
          data: callLogData,
        });

        await prisma.campaignContact.update({
          where: { id: contact.id },
          data: {
            callStatus: result === "COMPLETED" ? "COMPLETED" : "FAILED",
            lastCallAt: endedAt,
            ...(interestLevel ? { status: interestLevel } : {}),
          },
        });

        console.log(`[DRY-RUN] Result: ${result} (${callLog.id})`);
      } catch (err) {
        console.error(`[DRY-RUN] Contact processing failed (${contact.id})`, err);
        try {
          await prisma.campaignContact.update({
            where: { id: contact.id },
            data: { callStatus: "FAILED" },
          });
        } catch (updateErr) {
          console.error(`[DRY-RUN] Failed to mark contact as FAILED (${contact.id})`, updateErr);
        }
      }
    }

    const [pendingCount, inProgressCount] = await Promise.all([
      prisma.campaignContact.count({
        where: { campaignId, callStatus: "PENDING" },
      }),
      prisma.campaignContact.count({
        where: { campaignId, callStatus: "IN_PROGRESS" },
      }),
    ]);

    if (pendingCount === 0 && inProgressCount === 0) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { batchActive: false },
      });
      console.log(`[DRY-RUN] Batch completed ${campaignId}`);
    }
  } catch (err) {
    console.error(`[DRY-RUN] Batch failed ${campaignId}`, err);
  } finally {
    activeDryRunBatches.delete(campaignId);
  }
}
