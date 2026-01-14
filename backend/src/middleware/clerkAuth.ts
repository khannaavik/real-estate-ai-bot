import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@clerk/backend';

/**
 * Clerk authentication middleware
 * Verifies Bearer token using JWKS-based JWT verification with issuer.
 * Clerk is the ONLY identity provider - no Prisma User table, no foreign keys.
 * Returns 401 if token is missing or invalid.
 */
export async function clerkAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn('[CLERK AUTH] Missing or invalid Authorization header');
      res.status(401).json({
        ok: false,
        error: 'Unauthorized',
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    console.log('[CLERK AUTH] Verifying token...');

    // Verify token using Clerk JWKS-based verification with issuer
    const { payload } = await verifyToken(token, {
      issuer: "https://handy-oarfish-21.clerk.accounts.dev",
    });

    if (!payload) {
      console.error('[CLERK AUTH] Token verified but payload is undefined');
      return res.status(401).json({ error: "Invalid Clerk token" });
    }

    // Extract userId from JWT payload - try multiple possible claim names
    const clerkUserId =
      payload.userId ||
      payload.user_id ||
      payload.sub;

    if (!clerkUserId) {
      console.error('[CLERK AUTH] No userId in JWT payload:', payload);
      return res.status(401).json({ error: "Invalid Clerk token" });
    }

    // Attach userId to request - Clerk is the source of truth
    req.auth = { userId: clerkUserId };

    console.log('[CLERK AUTH] ✓ Authentication successful, userId:', clerkUserId);
    next();
  } catch (err: any) {
    console.error('[CLERK AUTH] ✗ Authentication failed:', err?.message || err);
    console.error('[CLERK AUTH] Error type:', err?.name);
    
    // Check if it's a specific Clerk error
    if (err?.statusCode) {
      console.error('[CLERK AUTH] Clerk API status code:', err.statusCode);
    }
    
    res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      details: process.env.NODE_ENV === 'development' ? err?.message : undefined,
    });
  }
}
