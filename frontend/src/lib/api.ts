/**
 * API clients. Hotel staff and Guestly admins have separate sessions: each
 * client keeps its access token in memory and refreshes it via its own
 * httpOnly cookie. On a 401 we try one refresh, then retry the request.
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

type Options = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

export function createClient<S extends { accessToken: string }>(authPrefix: string) {
  let accessToken: string | null = null;
  let onSessionEnd: (() => void) | null = null;
  let refreshing: Promise<S | null> | null = null;

  function refresh(): Promise<S | null> {
    const run = async () => {
      const res = await fetch(`${API_BASE}${authPrefix}/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) return null;
      const s = (await res.json()) as S;
      accessToken = s.accessToken;
      return s;
    };
    // Share the in-flight refresh so parallel 401s don't rotate the token twice.
    refreshing ??= run()
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function request<T>(path: string, opts: Options = {}, retried = false): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        credentials: "include",
        signal: opts.signal,
      });
    } catch {
      throw new ApiError(0, "network", "Can't reach Guestly. Check your internet connection and try again.");
    }

    if (res.status === 401 && !retried && !path.startsWith(authPrefix)) {
      if (await refresh()) return request<T>(path, opts, true);
      accessToken = null;
      onSessionEnd?.();
    }

    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, data?.code ?? "unknown", data?.message ?? "Something went wrong. Please try again.", data?.fields);
    }
    return data as T;
  }

  /** Fetches a protected file (e.g. an encrypted ID image) as a Blob using the session token. */
  async function blob(path: string, retried = false): Promise<Blob> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: "include",
    });
    if (res.status === 401 && !retried && (await refresh())) return blob(path, true);
    if (!res.ok) throw new ApiError(res.status, "file", "Couldn't load the image.");
    return res.blob();
  }

  return {
    request,
    blob,
    refresh,
    setToken: (t: string | null) => {
      accessToken = t;
    },
    onSessionEnd: (fn: () => void) => {
      onSessionEnd = fn;
    },
  };
}

export type User = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "manager" | "front_desk" | "housekeeping";
  organizationId: string;
};
export type Session = { accessToken: string; user: User };

/** Hotel-staff client. */
export const hotel = createClient<Session>("/auth");
export const api = hotel.request;

/** Maps API field errors onto a react-hook-form instance. Returns true if any were applied. */
export function applyFieldErrors(err: unknown, setError: (name: never, e: { message: string }) => void): boolean {
  if (!(err instanceof ApiError) || !err.fields) return false;
  for (const [k, v] of Object.entries(err.fields)) setError(k as never, { message: v });
  return true;
}
