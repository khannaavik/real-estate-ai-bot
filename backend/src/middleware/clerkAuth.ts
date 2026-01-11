import { Request, Response, NextFunction } from 'express';
import clerk from '@clerk/clerk-sdk-node';

/**
 * Clerk authentication middleware
 * Verifies Bearer token, extracts userId, fetches user from Clerk API,
 * and attaches both userId and email to req.auth
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

    // Verify token using Clerk - this extracts userId from JWT
    const sessionClaims = await clerk.verifyToken(token);

    if (!sessionClaims?.sub) {
      console.warn('[CLERK AUTH] Token verified but no userId (sub) found in claims');
      res.status(401).json({
        ok: false,
        error: 'Unauthorized',
      });
      return;
    }

    // Extract userId from JWT claims
    const userId = sessionClaims.sub;
    console.log('[CLERK AUTH] Token verified, userId:', userId);

    // Fetch full user from Clerk API (email is NOT in JWT by default)
    console.log('[CLERK AUTH] Fetching user from Clerk API...');
    const user = await clerk.users.getUser(userId);
    
    if (!user) {
      console.error('[CLERK AUTH] User not found in Clerk:', userId);
      res.status(401).json({
        ok: false,
        error: 'Unauthorized - user not found',
      });
      return;
    }

    // Extract email from user object
    // Clerk user object has primaryEmailAddress (EmailAddress object) or emailAddresses array
    const userAny = user as any;
    const primaryEmail = userAny.primaryEmailAddress?.emailAddress;
    const firstEmail = userAny.emailAddresses?.[0]?.emailAddress;
    const email = primaryEmail || firstEmail;
    
    if (!email) {
      console.error('[CLERK AUTH] User found but no primary email address:', userId);
      res.status(401).json({
        ok: false,
        error: 'Unauthorized - email not found',
      });
      return;
    }

    console.log('[CLERK AUTH] ✓ User fetched, email:', email);
    
    // Attach both userId and email to request
    req.auth = { userId, email };
    console.log('[CLERK AUTH] ✓ Authentication successful, userId:', userId, 'email:', email);
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
