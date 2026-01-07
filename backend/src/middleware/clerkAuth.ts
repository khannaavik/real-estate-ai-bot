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
      res.status(401).json({
        ok: false,
        error: 'Unauthorized',
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token using Clerk
    const sessionClaims = await clerk.verifyToken(token);

    if (sessionClaims?.sub) {
      // Extract userId from Clerk session and attach to request
      req.auth = { userId: sessionClaims.sub };
      next();
    } else {
      res.status(401).json({
        ok: false,
        error: 'Unauthorized',
      });
    }
  } catch (err: any) {
    console.error('[CLERK AUTH] Token verification failed:', err?.message || err);
    res.status(401).json({
      ok: false,
      error: 'Unauthorized',
    });
  }
}
