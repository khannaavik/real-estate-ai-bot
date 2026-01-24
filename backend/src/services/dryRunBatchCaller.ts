import { prisma } from "../prisma";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(minSeconds: number, maxSeconds: number): number {
  const minMs = minSeconds * 1000;
  const maxMs = maxSeconds * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

const activeDryRuns = new Set<string>();

export async function startDryRunBatch(campaignId: string): Promise<void> {
  if (activeDryRuns.has(campaignId)) return;
  activeDryRuns.add(campaignId);

  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, batchActive: true },
    });

    if (!campaign || !campaign.batchActive) {
      return;
    }

    const contacts = await prisma.campaignContact.findMany({
      where: { campaignId, callStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: { id: true },
    });

    if (contacts.length === 0) {
      return;
    }

    for (const contact of contacts) {
      try {
        const latestCampaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { batchActive: true },
        });

        if (!latestCampaign?.batchActive) {
          return;
        }

        const startedAt = new Date();
        const claim = await prisma.campaignContact.updateMany({
          where: { id: contact.id, callStatus: "PENDING" },
          data: { callStatus: "IN_PROGRESS", lastCallAt: startedAt },
        });

        if (claim.count === 0) {
          continue;
        }

        const callLog = await prisma.callLog.create({
          data: {
            campaignContactId: contact.id,
            startedAt,
          },
        });

        await sleep(randomBetween(5, 10));

        const outcomes = ["COMPLETED", "NO_ANSWER", "FAILED"] as const;
        const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
        const interestLevels = ["HOT", "WARM", "COLD"] as const;
        const interestLevel =
          outcome === "COMPLETED"
            ? interestLevels[Math.floor(Math.random() * interestLevels.length)]
            : "COLD";

        const endedAt = new Date();
        const aiSummary =
          outcome === "COMPLETED"
            ? "Dry run completed successfully"
            : outcome === "NO_ANSWER"
            ? "Dry run: no answer"
            : "Dry run failed";

        await prisma.callLog.update({
          where: { id: callLog.id },
          data: {
            endedAt,
            durationSeconds: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
            aiSummary,
            resultStatus: interestLevel,
          },
        });

        await prisma.campaignContact.update({
          where: { id: contact.id },
          data: {
            callStatus: outcome === "COMPLETED" ? "COMPLETED" : "FAILED",
            lastCallAt: endedAt,
            status: interestLevel,
          },
        });
      } catch (err) {
        console.error(`[BATCH] Dry run contact failed (${contact.id})`, err);
        try {
          await prisma.campaignContact.update({
            where: { id: contact.id },
            data: { callStatus: "FAILED" },
          });
        } catch (updateErr) {
          console.error(`[BATCH] Failed to mark contact as FAILED (${contact.id})`, updateErr);
        }
      }
    }
  } catch (err) {
    console.error(`[BATCH] Dry run failed for campaign ${campaignId}`, err);
  } finally {
    try {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { batchActive: false },
      });
    } catch (err) {
      console.error(`[BATCH] Failed to reset batchActive for ${campaignId}`, err);
    }
    activeDryRuns.delete(campaignId);
  }
}
