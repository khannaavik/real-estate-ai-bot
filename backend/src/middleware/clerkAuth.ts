import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@clerk/backend';

/**
 * Clerk authentication middleware
 * Verifies Bearer token and extracts userId from JWT claims.
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

    // Verify token using Clerk - this extracts userId from JWT
    const { payload: sessionClaims } = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    // Type assertion for JWT payload
    const claims = sessionClaims as { 
      userId?: string; 
      user_id?: string; 
      sub?: string; 
      [key: string]: any 
    };

    // Extract userId from JWT claims - try multiple possible claim names
    const clerkUserId =
      claims.userId ||
      claims.user_id ||
      claims.sub;

    if (!clerkUserId) {
      console.error('[CLERK AUTH] Token verified but no userId found', claims);
      res.status(401).json({ 
        ok: false, 
        error: "Invalid Clerk token" 
      });
      return;
    }

    // TEMP DEBUG (REMOVE LATER)
    console.log('[CLERK AUTH] JWT claims:', claims);

    // Attach userId to request - Clerk is the source of truth
    req.auth = {
      userId: clerkUserId,
    };

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
