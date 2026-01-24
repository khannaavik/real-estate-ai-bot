import { prisma } from "../prisma";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const activeDryRuns = new Set<string>();

export async function startBatchDryRun(campaignId: string): Promise<void> {
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

    await prisma.campaignContact.updateMany({
      where: { campaignId, callStatus: "IN_PROGRESS" },
      data: { callStatus: "PENDING" },
    });

    const contacts = await prisma.campaignContact.findMany({
      where: { campaignId, callStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { id: true },
    });

    if (contacts.length === 0) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { batchActive: false },
      });
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

        await sleep(3000);

        const completedAt = new Date();
        await prisma.callLog.update({
          where: { id: callLog.id },
          data: {
            endedAt: completedAt,
            durationSeconds: 3,
            aiSummary: "Dry run completed successfully",
            resultStatus: "WARM",
          },
        });

        await prisma.campaignContact.update({
          where: { id: contact.id },
          data: {
            callStatus: "COMPLETED",
            lastCallAt: completedAt,
            status: "WARM",
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
