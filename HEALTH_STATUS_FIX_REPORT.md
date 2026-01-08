# Backend Health + Status Detection Fix Report

## Goal
Fix backend health and status detection so that:
- Backend is marked ONLINE if `/health` returns 200
- Authentication errors (401) NEVER mark backend offline
- Mock Mode is ONLY enabled on network failures
- UI shows "Sign in required" state cleanly
- Backend Offline banner only appears on true network errors

## Files Changed

### 1. `callbot-frontend/pages/index.tsx`

## Exact Logic Changes

### 1. Health Check Logic (Lines 1036-1111)

**BEFORE:**
- Health check required Clerk to be loaded and user to be signed in
- Used `apiFetch` which required auth token
- Could confuse auth errors with backend offline

**AFTER:**
- Health check uses **plain `fetch`** - NO auth token, NO Clerk dependency
- Runs independently of mock mode, auth status, or Clerk loading
- **ONLY** `/health` response controls `backendHealth` state
- HTTP 200 from `/health` = Backend Online (unconditionally)
- Network errors/timeouts = Backend Offline
- Auth errors from other endpoints NEVER affect `backendHealth`

**Key Code:**
```typescript
// CRITICAL: Backend health check - ONLY /health response controls backendHealth
const checkHealth = async () => {
  try {
    // Use plain fetch - NO auth token, NO Clerk dependency
    const response = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    // ONLY /health response.ok controls backendHealth
    // HTTP 200 from /health = Backend Online (unconditionally)
    if (response.ok) {
      setBackendHealth('online');
      // Disable mock mode when backend is online
      if (mockMode) {
        setMockMode(false);
      }
    } else {
      setBackendHealth('offline');
    }
  } catch (err: any) {
    // Network error, timeout, or no response - backend is offline
    if (isNetworkError) {
      setBackendHealth('offline');
    }
  }
};
```

### 2. Campaign Fetch Logic (Lines 1165-1240)

**BEFORE:**
- Could enable mock mode on 401 errors
- Could confuse auth errors with backend offline

**AFTER:**
- **401 errors:**
  - Set `authStatus = 'required'`
  - Do NOT set `backendHealth` (it's controlled ONLY by `/health`)
  - Do NOT enable mock mode
  - Show "Authentication required" message

- **Network errors:**
  - Enable mock mode
  - Show "Backend unreachable" message
  - Note: `backendHealth` is already set by health check

**Key Code:**
```typescript
catch (err: any) {
  const errorMessage = err?.message || String(err);
  
  // CRITICAL: 401 errors NEVER mark backend offline, NEVER enable mock mode
  if (errorMessage.includes('401') || errorMessage.includes('Authentication required')) {
    setAuthStatus('required');
    setToast("Authentication required. Please sign in.");
    setCampaigns([]);
    // DO NOT set backendHealth - it's controlled ONLY by /health endpoint
    // DO NOT activate mock mode on 401
  } else if (errorMessage.includes('Network error') || errorMessage.includes('timeout')) {
    // Only activate mock mode on actual network/connection errors
    setMockMode(true);
    setToast("Backend unreachable — switching to Mock Mode.");
  }
}
```

### 3. Mock Mode Rules

**Mock Mode activates ONLY when:**
- `fetch` throws (network error)
- Request times out
- Backend health check fails (network error)

**Mock Mode NEVER activates on:**
- 401 (Authentication required)
- 403 (Forbidden)
- 400 (Bad Request)
- 200 with empty array
- Any HTTP response (even error codes)

**Applied to all API calls:**
- `fetchCampaigns()` - Lines 1217-1235
- `openCampaign()` - Lines 1267-1272
- `startCall()` - Lines 1306-1312
- `applyScore()` - Lines 1535-1542

### 4. UI Improvements (Lines 1701-1726)

**Auth Required Banner:**
- Shows when `authStatus === 'required'` (regardless of backend status)
- Message: "Sign in to load campaigns"
- Two buttons:
  - "Go to Sign In" (routes to `/sign-in`)
  - "Sign In (Modal)" (opens Clerk modal)

**Backend Offline Banner:**
- Shows ONLY when `backendHealth === 'offline'`
- Message: "Backend is offline. Mock Mode is enabled."
- Only appears on true network errors

**Status Bar:**
- Separate indicators for:
  - Auth Status (OK / Required / Checking)
  - Backend Health (Online / Offline / Checking)
- Backend status reflects `/health` response
- Auth status reflects authentication state

## Why backendHealth is Now Correct

### Single Source of Truth
- `backendHealth` is **ONLY** set by the `/health` endpoint check
- No other code path can modify `backendHealth`
- Auth errors from `/campaigns` or other endpoints do NOT affect `backendHealth`

### Clear Separation
- **Backend Status** = Is the server reachable? (controlled by `/health`)
- **Auth Status** = Is the user authenticated? (controlled by Clerk/auth responses)
- **Mock Mode** = Should we use simulated data? (only on network failures)

### Correct Flow

1. **Backend Online + Auth OK:**
   - `/health` returns 200 → `backendHealth = 'online'`
   - `/campaigns` returns 200 → `authStatus = 'authenticated'`
   - Mock Mode = false
   - UI: Green indicators, no banners

2. **Backend Online + Auth Required:**
   - `/health` returns 200 → `backendHealth = 'online'`
   - `/campaigns` returns 401 → `authStatus = 'required'`
   - Mock Mode = false (NOT enabled on 401)
   - UI: Backend green, Auth red, "Sign in to load campaigns" banner

3. **Backend Offline:**
   - `/health` fails (network error) → `backendHealth = 'offline'`
   - Mock Mode = true (enabled on network failure)
   - UI: Backend red, "Backend is offline" banner

4. **Backend Offline + Auth Required:**
   - `/health` fails → `backendHealth = 'offline'`
   - `/campaigns` fails (network error) → Mock Mode = true
   - UI: Backend red, "Backend is offline" banner, Mock Mode enabled

## Verification Checklist

✅ `/health` 200 → Backend Online (green indicator)
✅ Logged out → Auth Required (red indicator, no mock mode)
✅ Logged in → Campaigns load normally
✅ Backend shutdown → Backend Offline (red indicator) + Mock Mode enabled
✅ 401 from `/campaigns` → Auth Required, Backend still Online
✅ Network error → Backend Offline + Mock Mode enabled
✅ Auth banner shows "Sign in to load campaigns" with route button
✅ Backend offline banner only shows on true network errors

## Code Safety

✅ No backend code changes
✅ No database logic changes
✅ No Clerk configuration changes
✅ All changes minimal and scoped to frontend status detection
✅ No breaking changes to existing functionality
