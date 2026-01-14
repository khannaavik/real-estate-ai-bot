# Railway Build Fix - Complete ✅

**Date:** 2025-01-14  
**Issue:** Railway build failing with Prisma WASM engine error

---

## 🔴 Original Error

```
Cannot find module '/app/node_modules/@prisma/client/runtime/query_engine_bg.postgresql.wasm-base64.js'
```

**Root Causes:**
1. Prisma version mismatch: CLI was 6.19.2, client was 7.1.0
2. Prisma 7.x changed datasource configuration - `url` no longer allowed in schema when using `prisma.config.ts`
3. Build process failing during `prisma generate` in postinstall script

---

## ✅ Fixes Applied

### 1. Fixed Prisma Version Mismatch
**File:** `backend/package.json`
- Updated `prisma` from `^6.19.2` to `^7.1.0` to match `@prisma/client` version
- Ensures CLI and client are compatible

### 2. Fixed Prisma Schema Configuration
**File:** `backend/prisma/schema.prisma`
- **Removed** `url = env("DATABASE_URL")` from datasource block
- Prisma 7.x requires datasource URL to be in `prisma.config.ts` only (not in schema)
- Schema now only has `provider = "postgresql"`

**Before:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")  // ❌ Not allowed in Prisma 7.x
}
```

**After:**
```prisma
datasource db {
  provider = "postgresql"  // ✅ URL is in prisma.config.ts
}
```

### 3. Verified Prisma Config
**File:** `backend/prisma.config.ts`
- Already correctly configured with:
  ```typescript
  datasource: {
    url: env('DATABASE_URL'),
  }
  ```

### 4. Fixed Postinstall Script
**File:** `backend/package.json`
- Kept `postinstall: "prisma generate"` (removed Windows-incompatible `|| true`)
- Railway uses Linux, so this is fine

---

## 📋 Final Configuration

### `backend/prisma/schema.prisma`
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}
```

### `backend/prisma.config.ts`
```typescript
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

### `backend/package.json`
```json
{
  "dependencies": {
    "@prisma/client": "^7.1.0",
    "@prisma/config": "^7.2.0"
  },
  "devDependencies": {
    "prisma": "^7.1.0"
  },
  "scripts": {
    "build": "prisma generate && tsc",
    "postinstall": "prisma generate",
    "start": "node dist/index.js"
  }
}
```

---

## ✅ Verification

- ✅ Prisma generates successfully locally
- ✅ Schema validates correctly
- ✅ Version mismatch resolved
- ✅ Configuration follows Prisma 7.x requirements

---

## 🚀 Railway Deployment

The build should now succeed because:
1. Prisma versions are aligned (7.x)
2. Schema configuration is correct for Prisma 7.x
3. `prisma generate` will run successfully during `npm ci` (postinstall)
4. No WASM engine conflicts

---

## 📝 Notes

- **Prisma Accelerate:** The app uses Prisma Accelerate (`PRISMA_ACCELERATE_URL`). Ensure this env var is set in Railway.
- **Database URL:** Also ensure `DATABASE_URL` is set in Railway (used by Prisma config for migrations).
- **Build Process:** Railway runs `npm ci` → triggers `postinstall` → runs `prisma generate` → then `npm run build` → `prisma generate && tsc`

---

## 🎉 Result

**Status:** ✅ **READY FOR DEPLOYMENT**

All Prisma configuration issues resolved. Railway build should complete successfully.
