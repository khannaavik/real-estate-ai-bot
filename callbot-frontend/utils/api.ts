/**
 * API utility for authenticated backend requests
 * Automatically includes Clerk Bearer token in Authorization header
 */

/**
 * Get the API base URL from environment variable
 */
export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
}

/**
 * Client-side authenticated fetch helper
 * Use this in React components with useAuth hook
 * 
 * @param url - The API endpoint URL
 * @param options - Fetch options (method, body, etc.)
 * @param token - Clerk JWT token (obtained via getToken())
 * @param timeoutMs - Request timeout in milliseconds (default: 8000)
 * @throws Error with status code for non-2xx responses
 * @throws Error "Authentication required" if token is missing
 * @throws Error "Network error" for connection failures
 */
export async function authenticatedFetch(
  url: string,
  options?: RequestInit,
  token?: string | null,
  timeoutMs: number = 8000
): Promise<any> {
  // Log token presence for debugging
  if (!token) {
    console.warn('[API] No token provided to authenticatedFetch. Request may fail with 401.');
  } else {
    console.log('[API] Token present, attaching Authorization header');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> || {}),
    };

    // ALWAYS attach Authorization header if token is provided
    // Backend expects: Authorization: Bearer <JWT>
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      // Log warning but don't throw - let backend return 401
      console.warn('[API] No token available - request will likely return 401');
    }

    const response = await fetch(url, {
      ...options,
      headers: headers as HeadersInit,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle 401 explicitly - do NOT treat as network error
    if (response.status === 401) {
      const text = await response.text().catch(() => '');
      console.error('[API] 401 Unauthorized - Authentication required');
      throw new Error('HTTP 401: Authentication required');
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return await response.json();
    }

    return await response.text();
  } catch (err: any) {
    clearTimeout(timeoutId);
    
    // Distinguish between network errors and auth errors
    if (err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    
    // Re-throw auth errors as-is
    if (err.message?.includes('401') || err.message?.includes('Authentication required')) {
      throw err;
    }
    
    // Network/connection errors
    if (err.message?.includes('Failed to fetch') || err.message?.includes('network') || !err.message) {
      throw new Error('Network error: Backend unreachable');
    }
    
    throw err;
  }
}

