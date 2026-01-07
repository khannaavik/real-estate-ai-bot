import { Request, Response, NextFunction } from 'express';
import clerk from '@clerk/clerk-sdk-node';

/**
 * Clerk authentication middleware
 * Verifies Bearer token and attaches userId to req.auth
 * Returns 401 if token is missing or invalid
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

    // Verify token using Clerk
    const sessionClaims = await clerk.verifyToken(token);

    if (sessionClaims?.sub) {
      // Extract userId from Clerk session and attach to request
      const userId = sessionClaims.sub;
      req.auth = { userId };
      console.log('[CLERK AUTH] ✓ Token verified, userId:', userId);
      next();
    } else {
      console.warn('[CLERK AUTH] Token verified but no userId (sub) found in claims');
      res.status(401).json({
        ok: false,
        error: 'Unauthorized',
      });
    }
  } catch (err: any) {
    console.error('[CLERK AUTH] ✗ Token verification failed:', err?.message || err);
    console.error('[CLERK AUTH] Error type:', err?.name);
    res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      details: process.env.NODE_ENV === 'development' ? err?.message : undefined,
    });
  }
}
