# Architecture Compliance Audit Report
**Date:** 2025-01-XX  
**Objective:** Verify codebase matches finalized architecture (no User model, plain string userId, Clerk-only auth)

---

## 1️⃣ Prisma & Database

### ❌ Is there NO User model?
**Status: FAILED**
- **File:** `backend/prisma/schema.prisma`
- **Lines:** 9-16
- **Issue:** User model EXISTS with:
  ```prisma
  model User {
    id        String     @id
    email     String     @unique
    name      String?
    createdAt DateTime   @default(now())
    campaigns Campaign[]
    contacts  Contact[]
  }
  ```

### ❌ Does Campaign.userId exist as a plain String with NO foreign key or relation?
**Status: FAILED**
- **File:** `backend/prisma/schema.prisma`
- **Lines:** 31-50
- **Issue:** Campaign.userId is String BUT has FK relation:
  ```prisma
  model Campaign {
    userId                  String
    user                    User                     @relation(fields: [userId], references: [id])  // LINE 47
  }
  ```

### ❌ Are there any remaining relations referencing User, userId, or Clerk emails?
**Status: FAILED**
- **File:** `backend/prisma/schema.prisma`
- **Lines:** 47, 62
- **Issues:**
  - Campaign.user relation (line 47)
  - Contact.user relation (line 62)
  - User.campaigns relation (line 14)
  - User.contacts relation (line 15)

### ❌ Has a migration removing Campaign_userId_fkey been applied?
**Status: FAILED**
- **File:** `backend/prisma/migrations/`
- **Issue:** NO migration found that removes `Campaign_userId_fkey`
- **Found:** Initial migration creates FK (line 86 in `20251210100946_init/migration.sql`):
  ```sql
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ```

### ❌ Is there any migration that reintroduces a User FK?
**Status: N/A** (FK was never removed)

---

## 2️⃣ Backend Auth & Campaign Logic

### ✅ Is Clerk JWT verified correctly?
**Status: PASSED**
- **File:** `backend/src/middleware/clerkAuth.ts`
- **Lines:** 31, 43
- **Implementation:** Uses `clerk.verifyToken(token)` and extracts `sessionClaims.sub` as userId

### ⚠️ Is req.auth.userId used directly (no DB lookup)?
**Status: PARTIAL**
- **File:** `backend/src/middleware/clerkAuth.ts`
- **Lines:** 78
- **Status:** Middleware correctly sets `req.auth = { userId, email }` from Clerk
- **BUT:** Old auth code still exists in `backend/src/index.ts` (lines 143-189) that does DB lookup:
  ```typescript
  const dbUser = await prisma.user.findUnique({
    where: { email: clerkEmail },
  });
  ```
- **Note:** This old middleware appears unused (line 141 uses `clerkAuthMiddleware` instead)

### ✅ Does POST /api/campaigns store userId as Clerk userId string?
**Status: PASSED**
- **File:** `backend/src/index.ts`
- **Lines:** 2209-2212
- **Implementation:** 
  ```typescript
  const campaign = await prisma.campaign.create({
    data: {
      userId: userId, // Use Clerk userId directly
    }
  });
  ```

### ❌ Any connect, relation, or user: logic present?
**Status: FAILED**
- **File:** `backend/src/index.ts`
- **Lines:** 2209-2221
- **Issue:** Code uses direct userId assignment, BUT Prisma schema enforces FK constraint
- **Result:** Will fail at runtime with P2003 error if User doesn't exist in DB

### ✅ Does GET /api/campaigns filter by where: { userId: req.auth.userId }?
**Status: PASSED**
- **File:** `backend/src/index.ts`
- **Lines:** 1799-1800
- **Implementation:**
  ```typescript
  const campaigns = await prisma.campaign.findMany({
    where: { userId: userId }, // Matches Clerk userId directly
  });
  ```

### ❌ Any Prisma User, upsert, findUnique({ email }), or Clerk → DB mapping logic?
**Status: FAILED**
- **Files Found:**
  1. **`backend/src/index.ts`** (lines 174-179):
     ```typescript
     const dbUser = await prisma.user.findUnique({
       where: { email: clerkEmail },
     });
     ```
  2. **`backend/src/index.ts`** (lines 2264-2273): Error handler references User FK constraint:
     ```typescript
     if (err?.code === 'P2003') {
       // Foreign key constraint violation - User may not exist in database
       console.error('[POST /api/campaigns] Prisma User error - Foreign key constraint violation');
     }
     ```

---

## 3️⃣ Frontend Auth & API Calls

### ✅ Is Clerk token fetched via window.Clerk.session.getToken()?
**Status: PASSED**
- **File:** `callbot-frontend/pages/index.tsx`
- **Lines:** 66, 297
- **Implementation:** Uses `useAuth()` hook from `@clerk/nextjs`:
  ```typescript
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const token = await getToken();
  ```

### ✅ Is Authorization: Bearer <token> sent correctly?
**Status: PASSED**
- **File:** `callbot-frontend/utils/api.ts`
- **Lines:** 48-50
- **Implementation:**
  ```typescript
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  ```
- **Also:** `callbot-frontend/pages/index.tsx` line 34 includes token in headers

### ✅ Does modal close on success?
**Status: PASSED**
- **File:** `callbot-frontend/pages/index.tsx`
- **Lines:** 3400
- **Implementation:** `setShowNewCampaignModal(false)` called after successful 201 response

### ✅ Is campaign list refreshed after successful POST?
**Status: PASSED**
- **File:** `callbot-frontend/pages/index.tsx`
- **Lines:** 3429
- **Implementation:** `await fetchCampaigns()` called after modal close

### ✅ Are API errors surfaced to UI?
**Status: PASSED**
- **File:** `callbot-frontend/pages/index.tsx`
- **Lines:** 3434-3436, 3438-3460
- **Implementation:** Errors set to `campaignFormError` state and displayed in UI

---

## 4️⃣ Leads & Other Models

### ❌ Do Leads (or similar entities) also store userId as plain string?
**Status: FAILED**
- **File:** `backend/prisma/schema.prisma`
- **Lines:** 52-63
- **Issue:** Contact model has FK relation:
  ```prisma
  model Contact {
    userId    String
    user      User              @relation(fields: [userId], references: [id])  // LINE 62
  }
  ```

### ❌ Any FK or relation reuse of the old User model pattern?
**Status: FAILED**
- **Files:**
  1. `backend/prisma/schema.prisma` line 47: Campaign.user relation
  2. `backend/prisma/schema.prisma` line 62: Contact.user relation
  3. `backend/prisma/schema.prisma` lines 14-15: User.campaigns and User.contacts relations

---

## 5️⃣ Environment & Deployment

### ❓ Is Prisma client regenerated after migration?
**Status: UNKNOWN** (requires runtime check)

### ❓ Is Railway running the migrated schema?
**Status: UNKNOWN** (requires deployment check)

### ❓ Any schema mismatch warnings in logs?
**Status: UNKNOWN** (requires log inspection)

---

## 6️⃣ Red Flags (Explicitly Searched For)

### ❌ @relation
**Found:** 2 occurrences in schema
- `backend/prisma/schema.prisma` line 47: `user User @relation(fields: [userId], references: [id])`
- `backend/prisma/schema.prisma` line 62: `user User @relation(fields: [userId], references: [id])`

### ❌ User
**Found:** Multiple occurrences
- `backend/prisma/schema.prisma` lines 9-16: User model definition
- `backend/prisma/schema.prisma` line 47: Campaign.user relation
- `backend/prisma/schema.prisma` line 62: Contact.user relation
- `backend/src/index.ts` line 174: `prisma.user.findUnique`
- `backend/src/index.ts` line 2267: Error handler references "Prisma User error"

### ❌ user: { connect
**Found:** 0 occurrences (no connect logic found)

### ❌ findOrCreateUser
**Found:** 0 occurrences

### ❌ email → userId
**Found:** 1 occurrence
- `backend/src/index.ts` line 174-176: Maps Clerk email to DB User

### ❌ Campaign_userId_fkey
**Found:** 1 occurrence
- `backend/prisma/migrations/20251210100946_init/migration.sql` line 86: FK constraint creation

---

## 📊 Summary Checklist

- [✘] Prisma User model removed
- [✘] Campaign.userId is plain String (NO FK/relation)
- [✘] Contact.userId is plain String (NO FK/relation)
- [✘] Migration removing Campaign_userId_fkey applied
- [✘] Migration removing Contact_userId_fkey applied
- [✅] POST /api/campaigns uses Clerk userId directly
- [✅] GET /api/campaigns filters by Clerk userId
- [✅] Frontend uses Clerk getToken() correctly
- [✅] Frontend sends Authorization: Bearer token
- [✅] Modal closes on success
- [✅] Campaign list refreshes after creation
- [✅] API errors surfaced to UI
- [✘] Old auth middleware removed (still exists but unused)
- [✘] Error handler for User FK removed

---

## 🎯 Overall Verdict: **BLOCKED**

**Critical Issues:**
1. User model still exists in Prisma schema
2. Campaign and Contact models have FK relations to User
3. No migration removing FK constraints
4. Old auth code with DB lookup still present (unused but should be removed)
5. Runtime will fail with P2003 errors when User doesn't exist in DB

---

## 📝 Exact Next Code Changes Required

### Priority 1: Prisma Schema Changes
**File:** `backend/prisma/schema.prisma`

1. **Remove User model** (lines 9-16)
2. **Remove Campaign.user relation** (line 47):
   ```prisma
   // REMOVE THIS LINE:
   user                    User                     @relation(fields: [userId], references: [id])
   ```
3. **Remove Contact.user relation** (line 62):
   ```prisma
   // REMOVE THIS LINE:
   user      User              @relation(fields: [userId], references: [id])
   ```
4. **Keep userId as plain String** (lines 34, 54) - already correct

### Priority 2: Create Migration
**File:** `backend/prisma/migrations/YYYYMMDDHHMMSS_remove_user_fk/migration.sql`

```sql
-- Remove foreign key constraints
ALTER TABLE "Campaign" DROP CONSTRAINT IF EXISTS "Campaign_userId_fkey";
ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_userId_fkey";

-- Drop User table (if no other dependencies)
DROP TABLE IF EXISTS "User";
```

### Priority 3: Remove Old Auth Code
**File:** `backend/src/index.ts`

1. **Remove old authMiddleware function** (lines 143-189)
2. **Remove User FK error handler** (lines 2264-2273) - replace with generic error

### Priority 4: Regenerate Prisma Client
```bash
cd backend
npx prisma generate
```

### Priority 5: Apply Migration
```bash
cd backend
npx prisma migrate deploy
# OR for development:
npx prisma migrate dev --name remove_user_fk
```

---

## ⚠️ Deployment Notes

1. **Database Migration Required:** Must run migration on production before deploying code changes
2. **Data Loss Warning:** Dropping User table will delete all user records (if any exist)
3. **Backward Compatibility:** Existing campaigns/contacts with userId values will remain valid (as plain strings)
4. **Testing:** Verify campaign creation works after migration (should no longer get P2003 errors)
