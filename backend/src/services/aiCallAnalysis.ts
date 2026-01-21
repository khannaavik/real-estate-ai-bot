import OpenAI from "openai";

export type CallStatus = "PICKED" | "NO_ANSWER";
export type InterestLevel = "COLD" | "WARM" | "HOT";

export interface CallAnalysisInput {
  campaignName: string;
  leadName: string;
  callStatus: CallStatus;
}

export interface CallAnalysisResult {
  summary: string;
  interestLevel: InterestLevel;
  reasoning: string;
  nextAction: string;
}

const OPENAI_MODEL = "gpt-4.1";
const FALLBACK_RESULT: CallAnalysisResult = {
  summary: "Call completed. No significant intent detected.",
  interestLevel: "COLD",
  reasoning: "Fallback logic applied",
  nextAction: "Retry follow-up later",
};

const SYSTEM_PROMPT = `You are a senior real estate sales strategist.

Your goal is to maximize lead conversion while remaining honest, polite, and non-pushy.

You understand buyer intent, hesitation signals, urgency, and budget sensitivity.`;

const USER_PROMPT_TEMPLATE = `Context:
Campaign Name: {{campaignName}}
Lead Name: {{leadName}}
Call Status: {{callStatus}}

Task:
Analyze the call outcome and produce a sales-oriented assessment.

Return STRICT JSON with:
- summary: 2–3 natural sentences describing buyer intent or hesitation
- interestLevel: one of COLD, WARM, HOT
- reasoning: short explanation of why this interest level was chosen
- nextAction: the single best follow-up action to maximize conversion

Rules:
- Be realistic, not optimistic
- If Call Status is NO_ANSWER → interestLevel must be COLD
- Never exaggerate interest
- Never invent facts
- Output JSON only`;

function normalizeSummary(summary: string): string {
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length >= 2) {
    return lines.slice(0, 3).join("\n");
  }

  const fallbackLines = [summary.trim(), "Follow-up recommended."].filter(Boolean);
  return fallbackLines.slice(0, 2).join("\n");
}

function coerceInterestLevel(value: unknown): InterestLevel | null {
  if (value === "COLD" || value === "WARM" || value === "HOT") {
    return value;
  }
  return null;
}

function parseResult(content: string): CallAnalysisResult | null {
  try {
    const parsed = JSON.parse(content) as Partial<CallAnalysisResult>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const summary =
      typeof parsed.summary === "string" ? normalizeSummary(parsed.summary) : null;
    const interestLevel = coerceInterestLevel(parsed.interestLevel);
    const reasoning =
      typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0
        ? parsed.reasoning.trim()
        : null;
    const nextAction =
      typeof parsed.nextAction === "string" && parsed.nextAction.trim().length > 0
        ? parsed.nextAction.trim()
        : null;

    if (!summary || !interestLevel || !reasoning || !nextAction) {
      return null;
    }

    return { summary, interestLevel, reasoning, nextAction };
  } catch (error) {
    return null;
  }
}

/**
 * Analyze a call outcome using OpenAI. Never throws; always returns a result.
 */
export async function analyzeCallOutcome({
  campaignName,
  leadName,
  callStatus,
}: CallAnalysisInput
): Promise<CallAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const fallback = FALLBACK_RESULT;

  if (!apiKey) {
    return fallback;
  }

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: USER_PROMPT_TEMPLATE.replace("{{campaignName}}", campaignName)
            .replace("{{leadName}}", leadName)
            .replace("{{callStatus}}", callStatus),
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return fallback;
    }

    const parsed = parseResult(content);
    if (!parsed) {
      return fallback;
    }

    if (callStatus === "NO_ANSWER" && parsed.interestLevel !== "COLD") {
      return { ...parsed, interestLevel: "COLD" };
    }

    return parsed;
  } catch (error) {
    console.error("[AI Call Analysis] OpenAI error:", error);
    return fallback;
  }
}
