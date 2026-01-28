import twilioClientFactory from "twilio";

const CALL_MODE = (process.env.CALL_MODE || "DRY_RUN").toUpperCase();
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER as string;

export function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set");
  }

  return twilioClientFactory(accountSid, authToken);
}

const twilio = getTwilioClient();

export async function createLiveCall({
  to,
  campaignId,
  leadId,
}: {
  to: string;
  campaignId?: string;
  leadId?: string;
}): Promise<any> {
  const twiml = `
<Response>
  <Say voice="alice">
    This is a live test call from CallBot.
  </Say>
</Response>
`;

  console.log("[TWIML_SENT]", twiml);
  console.log("[CALL_TO]", to);

  if (CALL_MODE !== "LIVE") {
    return { sid: `DRY_RUN_${Date.now()}`, status: "dry-run" };
  }

  try {
    const call = await twilio.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER!,
      twiml,
    });
    return call;
  } catch (err: any) {
    console.error("[TWILIO_ERROR]", err);
    console.error("[TWILIO_PAYLOAD]", {
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      twiml,
    });
    throw err;
  }
}
