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
 */
export async function authenticatedFetch(
  url: string,
  options?: RequestInit,
  token?: string | null
): Promise<any> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options?.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return await response.json();
  }

  return await response.text();
}

