const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ── Token management ──
const TOKEN_KEY = "kirimly_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ── Fetch wrapper ──
interface ApiOptions extends RequestInit {
  params?: Record<string, string | number | undefined>;
}

class ApiError extends Error {
  status: number;
  body: any;

  constructor(message: string, status: number, body?: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T = any>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const { params, ...fetchOptions } = options;

  // Build URL
  let url = `${API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) searchParams.set(key, String(val));
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  // Headers
  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string>),
  };

  // Auto JSON content-type for non-FormData bodies
  if (
    fetchOptions.body &&
    typeof fetchOptions.body === "string" &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  // Auth
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, { ...fetchOptions, headers });

    // Handle 401 — token expired / invalid
    if (res.status === 401) {
      removeToken();
      throw new ApiError("Unauthorized", 401);
    }

    const data = await res.json();

    if (!res.ok) {
      throw new ApiError(
        data?.error || `Request failed with status ${res.status}`,
        res.status,
        data
      );
    }

    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      err instanceof Error ? err.message : "Network error",
      0
    );
  }
}

// ── Convenience methods ──
export const api = {
  get: <T = any>(endpoint: string, options?: ApiOptions) =>
    request<T>(endpoint, { ...options, method: "GET" }),

  post: <T = any>(endpoint: string, body?: any, options?: ApiOptions) =>
    request<T>(endpoint, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T = any>(endpoint: string, body?: any, options?: ApiOptions) =>
    request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),

  del: <T = any>(endpoint: string, options?: ApiOptions) =>
    request<T>(endpoint, { ...options, method: "DELETE" }),
};

export { ApiError };
