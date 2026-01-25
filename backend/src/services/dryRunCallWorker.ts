import OpenAI from "openai";
import { prisma } from "../prisma";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Rate limiting configuration from environment variables
const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || "1", 10);
const CALL_DELAY_MS = parseInt(process.env.CALL_DELAY_MS || "45000", 10);

function randomBetweenMs(minSeconds: number, maxSeconds: number): number {
  const minMs = minSeconds * 1000;
  const maxMs = maxSeconds * 1000;
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function randomBetweenSeconds(minSeconds: number, maxSeconds: number): number {
  return Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
}

type DryRunResult = "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED";
type DryRunInterest = "HOT" | "WARM" | "COLD" | "NONE";
type DryRunNextAction = "CALLBACK" | "IGNORE" | "FOLLOW_UP";

type AiCallAnalysis = {
  summary: string;
  interestLevel: "HOT" | "WARM" | "COLD";
  nextAction: DryRunNextAction;
};

function getOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function safeParseJson(content: string): AiCallAnalysis | null {
  try {
    const parsed = JSON.parse(content) as AiCallAnalysis;
    if (!parsed?.summary || !parsed?.interestLevel || !parsed?.nextAction) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function generateAiSummary(input: {
  contactPhone: string;
  openingScript: string | null;
  tone: "FORMAL" | "FRIENDLY" | "ASSERTIVE";
  language: "EN";
}): Promise<AiCallAnalysis | null> {
  const client = getOpenAiClient();
  if (!client) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4.1";
  const prompt = [
    "You are analyzing a simulated outbound call.",
    "Return JSON only with fields: summary, interestLevel, nextAction.",
    "interestLevel must be one of: HOT, WARM, COLD.",
    "nextAction must be one of: CALLBACK, IGNORE, FOLLOW_UP.",
    "Keep summary to 1-2 sentences, realistic and concise.",
    `Tone: ${input.tone}.`,
    `Language: ${input.language}.`,
    `Opening script: ${input.openingScript || "N/A"}.`,
    `Contact phone: ${input.contactPhone || "unknown"}.`,
  ].join("\n");

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 120,
      temperature: 0.6,
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = safeParseJson(content);
    if (parsed) {
      console.log("[AI] Summary generated");
      console.log(`[AI] Interest: ${parsed.interestLevel}`);
      return parsed;
    }

    return null;
  } catch (err) {
    console.error("[AI] Summary generation failed", err);
    return null;
  }
}

export async function startDryRunCallWorker(campaignId: string): Promise<void> {
  try {
    console.log(`[BATCH START] Campaign ${campaignId}`);
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
        data: { batchActive: false, batchState: "COMPLETED" },
      });
      console.log(`[BATCH COMPLETE] Campaign ${campaignId}`);
      console.log(`[DRY-RUN] Batch completed ${campaignId}`);
      return;
    }

    // Rate limiting: Ensure sequential execution (MAX_CONCURRENT_CALLS = 1)
    // Process contacts one at a time
    for (const contact of contacts) {
      try {
        let campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: {
            batchActive: true,
            batchState: true,
            openingScript: true,
            tone: true,
            language: true,
          },
        });

        console.log(`[BATCH] State check: ${campaign?.batchState ?? "UNKNOWN"}`);

        if (!campaign?.batchActive || campaign.batchState === "STOPPED") {
          console.log(`[BATCH] Stopped campaign ${campaignId}`);
          break;
        }

        if (campaign.batchState === "COMPLETED") {
          console.log(`[BATCH] Completed campaign ${campaignId}`);
          break;
        }

        while (campaign.batchState === "PAUSED") {
          console.log(`[BATCH] Paused campaign ${campaignId}`);
          await sleep(2000);
          const refreshedCampaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { batchActive: true, batchState: true },
          });
          if (!refreshedCampaign?.batchActive || refreshedCampaign.batchState === "STOPPED") {
            console.log(`[BATCH] Stopped campaign ${campaignId}`);
            return;
          }
          if (refreshedCampaign.batchState === "COMPLETED") {
            console.log(`[BATCH] Completed campaign ${campaignId}`);
            return;
          }
          campaign.batchState = refreshedCampaign.batchState;
        }

        await prisma.campaignContact.update({
          where: { id: contact.id },
          data: { callStatus: "IN_PROGRESS" },
        });

        console.log(`[CALL START] Lead ${contact.id}`);
        console.log(`[DRY-RUN] Calling ${contact.contact?.phone || contact.id}`);

        await sleep(randomBetweenMs(5, 15));

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

        const transcript =
          result === "COMPLETED"
            ? "Dry run transcript: simulated customer conversation."
            : null;

        let interestLevel: DryRunInterest = "NONE";
        let nextAction: DryRunNextAction =
          result === "FAILED" ? "IGNORE" : "CALLBACK";
        let aiSummary = `Dry run result: ${result}`;

        if (result === "COMPLETED") {
          const fallbackInterestLevels: DryRunInterest[] = ["HOT", "WARM", "COLD"];
          const fallbackInterest =
            fallbackInterestLevels[Math.floor(Math.random() * fallbackInterestLevels.length)];
          const aiResult = await generateAiSummary({
            contactPhone: contact.contact?.phone || "",
            openingScript: campaign?.openingScript || null,
            tone: campaign?.tone || "FRIENDLY",
            language: campaign?.language || "EN",
          });
          interestLevel = aiResult?.interestLevel ?? fallbackInterest;
          nextAction = aiResult?.nextAction ?? "FOLLOW_UP";
          aiSummary = aiResult?.summary ?? "Dry run completed successfully";
        }

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

        if (interestLevel !== "NONE") {
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
            ...(interestLevel !== "NONE" ? { status: interestLevel } : {}),
            callResult: {
              outcome: result,
              interestLevel,
              summary: aiSummary,
              nextAction,
              durationSec: durationSeconds,
            },
          },
        });

        console.log(`[CALL END] Lead ${contact.id}`);
        console.log(`[DRY-RUN] Result: ${result}`);

        // Rate limiting: Add delay after each call ends (before next call starts)
        if (CALL_DELAY_MS > 0) {
          console.log(`[RATE LIMIT] Waiting ${CALL_DELAY_MS / 1000}s before next call`);
          await sleep(CALL_DELAY_MS);
        }
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

    const finalCampaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { batchState: true },
    });

    if (
      pendingCount === 0 &&
      inProgressCount === 0 &&
      finalCampaign?.batchState !== "STOPPED"
    ) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { batchActive: false, batchState: "COMPLETED" },
      });
      console.log(`[BATCH COMPLETE] Campaign ${campaignId}`);
      console.log(`[BATCH] Completed campaign ${campaignId}`);
    }
  } catch (err) {
    console.error(`[DRY-RUN] Batch failed ${campaignId}`, err);
  }
}
