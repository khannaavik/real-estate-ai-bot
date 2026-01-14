# Clerk SDK Migration Fix - Complete ✅

**Date:** 2025-01-14  
**Issue:** Railway build failing with TypeScript errors in Clerk authentication

---

## 🔴 Original Errors

```
src/middleware/clerkAuth.ts(31,39): error TS2554: Expected 2 arguments, but got 1.
src/middleware/clerkAuth.ts(48,30): error TS2339: Property 'users' does not exist on type 'typeof import("/app/node_modules/@clerk/clerk-sdk-node/dist/index")'.
```

**Root Cause:**
- Using deprecated `@clerk/clerk-sdk-node` package (EOL January 10, 2025)
- API has changed in `@clerk/backend` (the replacement package)

---

## ✅ Fixes Applied

### 1. Migrated from `@clerk/clerk-sdk-node` to `@clerk/backend`

**File:** `backend/src/middleware/clerkAuth.ts`

**Before:**
```typescript
import clerk from '@clerk/clerk-sdk-node';

// Old API (deprecated)
const sessionClaims = await clerk.verifyToken(token);
const user = await clerk.users.getUser(userId);
```

**After:**
```typescript
import { createClerkClient, verifyToken } from '@clerk/backend';

// New API
const { payload: sessionClaims } = await verifyToken(token, {
  secretKey: process.env.CLERK_SECRET_KEY,
});

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const user = await clerkClient.users.getUser(userId);
```

### 2. Updated Token Verification

- `verifyToken()` now requires 2 arguments: token + options object
- Must provide `secretKey` in options (from `CLERK_SECRET_KEY` env var)
- Returns `{ payload, ... }` instead of direct claims

### 3. Updated Client Creation

- Use `createClerkClient()` instead of default export
- Must provide `secretKey` when creating client
- Client instance is created per request (can be optimized later)

### 4. Fixed TypeScript Types

- Added type assertion for JWT payload: `as { sub?: string; [key: string]: any }`
- Properly handles unknown return type from `verifyToken`

### 5. Removed Unused Import

**File:** `backend/src/index.ts`
- Removed unused `import clerk from '@clerk/clerk-sdk-node'`

---

## 📋 Final Code

### `backend/src/middleware/clerkAuth.ts`
```typescript
import { Request, Response, NextFunction } from 'express';
import { createClerkClient, verifyToken } from '@clerk/backend';

export async function clerkAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const token = authHeader.substring(7);

    // Verify token - NEW API requires options object
    const { payload: sessionClaims } = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    // Type assertion for JWT payload
    const claims = sessionClaims as { sub?: string; [key: string]: any };

    if (!claims?.sub) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const userId = claims.sub;

    // Create client and fetch user - NEW API
    const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const user = await clerkClient.users.getUser(userId);
    
    // ... rest of the code
  } catch (err: any) {
    // ... error handling
  }
}
```

---

## 🔑 Environment Variables Required

Ensure these are set in Railway:

1. **`CLERK_SECRET_KEY`** - Required for token verification and API calls
   - Get from Clerk Dashboard → API Keys → Secret Key

---

## ✅ Verification

- ✅ TypeScript compilation passes
- ✅ Build completes successfully
- ✅ All Clerk API calls updated to new SDK
- ✅ No deprecated package usage

---

## 📝 Package Status

**Current Dependencies:**
- `@clerk/backend`: `^2.29.0` ✅ (Active, recommended)
- `@clerk/clerk-sdk-node`: `^5.1.6` ⚠️ (Deprecated, can be removed)

**Note:** You can optionally remove `@clerk/clerk-sdk-node` from `package.json` since it's no longer used, but keeping it won't cause issues.

---

## 🚀 Railway Deployment

The build should now succeed because:
1. ✅ All TypeScript errors resolved
2. ✅ Clerk SDK migrated to modern API
3. ✅ Proper type handling
4. ✅ Environment variable usage correct

**Important:** Ensure `CLERK_SECRET_KEY` is set in Railway environment variables!

---

## 🎉 Result

**Status:** ✅ **READY FOR DEPLOYMENT**

All Clerk authentication issues resolved. Railway build should complete successfully.
