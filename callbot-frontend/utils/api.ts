/**
 * API utility for authenticated backend requests
 * Automatically includes dashboard PIN in x-dashboard-pin header
 */

/**
 * Get the API base URL from environment variable
 */
export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
}

/**
 * Client-side authenticated fetch helper
 * Uses dashboard PIN from localStorage
 * 
 * @param url - The API endpoint URL
 * @param options - Fetch options (method, body, etc.)
 * @param timeoutMs - Request timeout in milliseconds (default: 8000)
 * @throws Error with status code for non-2xx responses
 * @throws Error "Authentication required" if PIN is missing
 * @throws Error "Network error" for connection failures
 */
export async function authenticatedFetch(
  url: string,
  options?: RequestInit,
  token?: string | null,
  timeoutMs: number = 8000
): Promise<any> {
  const dashboardPin =
    typeof window !== "undefined" ? localStorage.getItem("dashboard_pin") : null;
  if (!dashboardPin) {
    console.warn('[API] No dashboard PIN found in localStorage. Request may fail with 401.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> || {}),
    };

    if (dashboardPin) {
      headers['x-dashboard-pin'] = dashboardPin;
    } else {
      console.warn('[API] No dashboard PIN available - request will likely return 401');
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
    let data: any;
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Return object with status and data for status code checking
    // For backward compatibility, also spread data properties at top level if data is an object
    const result: any = {
      status: response.status,
      data: data,
    };
    
    // Spread data properties for backward compatibility (existing code expects data.campaigns, etc.)
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      Object.assign(result, data);
    }
    
    return result;
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

