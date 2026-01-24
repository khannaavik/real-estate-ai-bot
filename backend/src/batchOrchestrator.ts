import { prisma } from "./prisma";

/**
 * Get retry metadata from CampaignContact.
 * Uses extraContext for backward compatibility (no schema migration required).
 */
export async function getRetryMetadata(campaignContactId: string): Promise<{
  retryCount: number;
  lastAttemptedAt: Date | null;
  lastRetryReason: string | null;
}> {
  try {
    const contact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
    });

    if (!contact) {
      return { retryCount: 0, lastAttemptedAt: null, lastRetryReason: null };
    }

    const extraContext = (contact as any).extraContext;
    if (extraContext?.retryMetadata) {
      return {
        retryCount: extraContext.retryMetadata.retryCount || 0,
        lastAttemptedAt: extraContext.retryMetadata.lastAttemptedAt
          ? new Date(extraContext.retryMetadata.lastAttemptedAt)
          : null,
        lastRetryReason: extraContext.retryMetadata.lastRetryReason || null,
      };
    }

    const notPickCalls = await prisma.callLog.count({
      where: {
        campaignContactId,
        resultStatus: "NOT_PICK",
      },
    });

    return {
      retryCount: notPickCalls,
      lastAttemptedAt: contact.lastCallAt,
      lastRetryReason: null,
    };
  } catch (err) {
    console.error("[BATCH] Retry metadata read failed:", err);
    return { retryCount: 0, lastAttemptedAt: null, lastRetryReason: null };
  }
}

/**
 * Update retry metadata on CampaignContact.
 * Uses extraContext for backward compatibility.
 */
export async function updateRetryMetadata(
  campaignContactId: string,
  retryCount: number,
  lastRetryReason: string
): Promise<void> {
  try {
    const contact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
    });

    if (!contact) return;

    const extraContext = (contact as any).extraContext || {};
    extraContext.retryMetadata = {
      retryCount,
      lastAttemptedAt: new Date().toISOString(),
      lastRetryReason,
    };

    await (prisma.campaignContact.update as any)({
      where: { id: campaignContactId },
      data: {
        extraContext: extraContext,
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[BATCH] Retry metadata update skipped:", err);
    }
  }
}
