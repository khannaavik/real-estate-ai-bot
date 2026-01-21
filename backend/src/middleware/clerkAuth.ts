import { Request, Response, NextFunction } from "express";
import { verifyToken } from "@clerk/backend";

type ClerkJWTPayload = {
  userId?: string;
  user_id?: string;
  sub?: string;
  [key: string]: any;
};

export async function clerkAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const token = authHeader.slice(7);
    console.log("[CLERK AUTH] Verifying token...");

    const publicKey = process.env.CLERK_JWT_KEY?.replace(/\\n/g, "\n");

    if (!publicKey) {
      throw new Error("CLERK_JWT_KEY is missing");
    }

    console.log(
      "[CLERK AUTH] JWT key loaded, length:",
      publicKey.length
    );

    const { payload } = await verifyToken(token, {
      jwtKey: publicKey,
    });

    if (!payload) {
      res.status(401).json({ ok: false, error: "Invalid token" });
      return;
    }

    const claims = payload as ClerkJWTPayload;

    const clerkUserId =
      claims.userId ||
      claims.user_id ||
      claims.sub;

    if (!clerkUserId) {
      console.error("[CLERK AUTH] No userId in token:", claims);
      res.status(401).json({ ok: false, error: "Invalid token" });
      return;
    }

    req.auth = { userId: clerkUserId };

    console.log("[CLERK AUTH] ✓ Authenticated:", clerkUserId);
    next();
  } catch (error) {
    console.error("[CLERK AUTH] ✗ Authentication failed:", error);
    res.status(401).json({ ok: false, error: "Unauthorized" });
  }
}
