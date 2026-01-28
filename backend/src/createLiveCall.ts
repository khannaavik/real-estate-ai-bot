import twilioClientFactory from "twilio";

const CALL_MODE = (process.env.CALL_MODE || "DRY_RUN").toUpperCase();
const ILLEGAL_CALL_PATH_MESSAGE =
  "ILLEGAL_CALL_PATH: calls.create must be invoked via createLiveCall in LIVE mode.";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER as string;

type TwilioCallParams = {
  to: string;
  from: string;
  twiml?: string;
  url?: string;
  [key: string]: any;
};

let guardedTwilioClient: ReturnType<typeof twilioClientFactory> | null = null;
let allowLiveCreate = true;

function logIllegalCallPath(params?: { to?: string }): void {
  const logData = {
    event: "ILLEGAL_CALL_PATH",
    timestamp: new Date().toISOString(),
    to: params?.to || null,
  };
  console.error("ILLEGAL_CALL_PATH", JSON.stringify(logData, null, 2));
}

export function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set");
  }

  if (!guardedTwilioClient) {
    const client = twilioClientFactory(accountSid, authToken);
    const originalCreate = client.calls.create.bind(client.calls);

    client.calls.create = (async (...args: any[]) => {
      if (CALL_MODE === "LIVE" && !allowLiveCreate) {
        const to = args?.[0]?.to;
        logIllegalCallPath({ to });
        throw new Error(ILLEGAL_CALL_PATH_MESSAGE);
      }
      return originalCreate(...args);
    }) as any;

    guardedTwilioClient = client;
  }

  return guardedTwilioClient;
}

const twilio = getTwilioClient();

function enforceProgrammableVoiceOnly(
  callParams: { to?: string; sipTrunk?: string; sipDomain?: string; [key: string]: any }
): void {
  const sipEnabled = process.env.ENABLE_SIP_TRUNKING === "true";
  if (CALL_MODE === "LIVE" && !sipEnabled) {
    const toValue = typeof callParams.to === "string" ? callParams.to : "";
    const looksLikeSip = toValue.toLowerCase().startsWith("sip:");
    if (looksLikeSip || callParams.sipTrunk || callParams.sipDomain) {
      throw new Error(
        "SIP Trunking is disabled. Enable via ENABLE_SIP_TRUNKING=true to use SIP; " +
          "otherwise only Programmable Voice with TwiML is allowed in LIVE mode."
      );
    }
  }
}

function logTwilioCallBefore(params: {
  campaignId?: string;
  leadId?: string;
  to: string;
  callMode: string;
  hasTwiml: boolean;
  hasUrl: boolean;
}): void {
  const logData = {
    event: "TWILIO_CALL_BEFORE",
    timestamp: new Date().toISOString(),
    campaignId: params.campaignId || null,
    leadId: params.leadId || null,
    to: params.to,
    callMode: params.callMode,
    mediaType: params.hasTwiml ? "twiml" : params.hasUrl ? "url" : "NONE",
    hasMediaInstructions: params.hasTwiml || params.hasUrl,
  };

  if (!logData.hasMediaInstructions) {
    console.error(
      "[TWILIO_CALL_BEFORE] ⚠️  WARNING: Call created WITHOUT TwiML/URL!",
      JSON.stringify(logData, null, 2)
    );
  } else {
    console.log("[TWILIO_CALL_BEFORE]", JSON.stringify(logData, null, 2));
  }
}

function logTwilioCallAfter(params: {
  campaignId?: string;
  leadId?: string;
  callSid: string;
  callStatus: string;
}): void {
  const logData = {
    event: "TWILIO_CALL_AFTER",
    timestamp: new Date().toISOString(),
    campaignId: params.campaignId || null,
    leadId: params.leadId || null,
    callSid: params.callSid,
    callStatus: params.callStatus,
  };

  console.log("[TWILIO_CALL_AFTER]", JSON.stringify(logData, null, 2));
}

export async function createLiveCall({
  to,
  campaignId,
  leadId,
}: {
  to: string;
  campaignId?: string;
  leadId?: string;
}): Promise<any> {
  return twilio.calls.create({
    to,
    from: TWILIO_PHONE_NUMBER,
    twiml: `<Response><Say>This is a final live test</Say></Response>`,
  });
}
