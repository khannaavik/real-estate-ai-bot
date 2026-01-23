import { prisma } from "../prisma";
import { analyzeCallOutcome, type CallStatus as AICallStatus } from "./aiCallAnalysis";

type LeadCallStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function startMockCall(leadId: string): Promise<{ callId: string; status: "PICKED" | "NO_ANSWER" }> {
  const campaignContact = await prisma.campaignContact.findUnique({
    where: { id: leadId },
    select: { id: true, campaignId: true },
  });

  if (!campaignContact) {
    throw new Error("Lead not found");
  }

  const call = await prisma.call.create({
    data: {
      campaignId: campaignContact.campaignId,
      leadId: campaignContact.id,
      status: "STARTED",
    },
  });

  const pickedUp = Math.random() < 0.7;
  const nextStatus: "PICKED" | "NO_ANSWER" = pickedUp ? "PICKED" : "NO_ANSWER";

  await prisma.call.update({
    where: { id: call.id },
    data: { status: nextStatus },
  });

  await prisma.campaignContact.update({
    where: { id: campaignContact.id },
    data: { lastCallAt: new Date() },
  });

  return { callId: call.id, status: nextStatus };
}

async function endMockCall(callId: string): Promise<void> {
  const existingCall = await prisma.call.findUnique({
    where: { id: callId },
  });

  if (!existingCall) {
    throw new Error("Call not found");
  }

  const durationSec = Math.floor(Math.random() * 31) + 10;
  const callStatusForAnalysis: AICallStatus =
    existingCall.status === "NO_ANSWER" ? "NO_ANSWER" : "PICKED";

  const [campaign, lead] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: existingCall.campaignId },
      select: { name: true },
    }),
    prisma.campaignContact.findUnique({
      where: { id: existingCall.leadId },
      select: { contact: { select: { name: true } } },
    }),
  ]);

  const campaignName = campaign?.name || "Campaign";
  const leadName = lead?.contact?.name || "Lead";

  const aiResult = await analyzeCallOutcome({
    campaignName,
    leadName,
    callStatus: callStatusForAnalysis,
  });

  await prisma.call.update({
    where: { id: existingCall.id },
    data: {
      status: "COMPLETED",
      durationSec,
      interestLevel: aiResult.interestLevel,
      summary: aiResult.summary,
    },
  });

  if (existingCall.leadId) {
    const leadStatus =
      aiResult.interestLevel === "HOT"
        ? "HOT"
        : aiResult.interestLevel === "WARM"
        ? "WARM"
        : "COLD";
    await prisma.campaignContact.update({
      where: { id: existingCall.leadId },
      data: {
        lastCallAt: new Date(),
        status: leadStatus,
      },
    });
  }
}

export async function processNextLead(campaignId: string): Promise<boolean> {
  const lead = await prisma.campaignContact.findFirst({
    where: {
      campaignId,
      callStatus: { in: ["PENDING", null as unknown as LeadCallStatus] },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!lead) return false;

  const claim = await prisma.campaignContact.updateMany({
    where: {
      id: lead.id,
      callStatus: { in: ["PENDING", null as unknown as LeadCallStatus] },
    },
    data: { callStatus: "IN_PROGRESS" },
  });

  if (claim.count === 0) {
    return true;
  }

  try {
    const { callId } = await startMockCall(lead.id);
    await sleep(randomBetween(2000, 4000));
    await endMockCall(callId);
    await prisma.campaignContact.update({
      where: { id: lead.id },
      data: { callStatus: "COMPLETED" },
    });
  } catch (err) {
    await prisma.campaignContact.update({
      where: { id: lead.id },
      data: { callStatus: "FAILED" },
    });
  }

  return true;
}

const activeCampaigns = new Set<string>();

export async function startBatchProcessing(campaignId: string): Promise<void> {
  if (activeCampaigns.has(campaignId)) return;
  activeCampaigns.add(campaignId);

  try {
    while (true) {
      const hasNext = await processNextLead(campaignId);
      if (!hasNext) break;
      await sleep(randomBetween(5000, 10000));
    }
  } finally {
    activeCampaigns.delete(campaignId);
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { batchActive: false },
    });
  }
}

export async function resumeActiveBatches(): Promise<void> {
  const campaigns = await prisma.campaign.findMany({
    where: { batchActive: true },
    select: { id: true },
  });

  for (const campaign of campaigns) {
    await prisma.campaignContact.updateMany({
      where: {
        campaignId: campaign.id,
        callStatus: "IN_PROGRESS",
      },
      data: { callStatus: "PENDING" },
    });

    void startBatchProcessing(campaign.id);
  }
}
