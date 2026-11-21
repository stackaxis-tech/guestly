/**
 * API clients. Hotel staff and Gustlog admins have separate sessions: each
 * client keeps its access token in memory and refreshes it via its own
 * httpOnly cookie. On a 401 we try one refresh, then retry the request.
 */
import { isNative } from "./platform";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8085/api/v1";

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

const REFRESH_KEY = "guestlog.refresh";

/** The refresh token lives in the iOS Keychain / Android Keystore, never in web storage. */
// Destructure the plugin inside each function: Capacitor plugins are proxies that
// answer to any property, so returning one from an async function hangs on ".then".
async function readRefreshToken(): Promise<string | null> {
  const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
  try {
    return (await SecureStorage.get(REFRESH_KEY)) as string | null;
  } catch {
    return null;
  }
}
async function writeRefreshToken(token: string | null) {
  const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
  if (token) await SecureStorage.set(REFRESH_KEY, token);
  else await SecureStorage.remove(REFRESH_KEY);
}

export function createClient<S extends { accessToken: string; refreshToken?: string }>(authPrefix: string, native = false) {
  let accessToken: string | null = null;
  let onSessionEnd: (() => void) | null = null;
  let refreshing: Promise<S | null> | null = null;

  function refresh(): Promise<S | null> {
    const run = async () => {
      let init: RequestInit = { method: "POST", credentials: "include" };
      if (native) {
        const stored = await readRefreshToken();
        if (!stored) return null;
        init = { method: "POST", headers: { "Content-Type": "application/json", "X-Client": "mobile" }, body: JSON.stringify({ refreshToken: stored }) };
      }
      const res = await fetch(`${API_BASE}${authPrefix}/refresh`, init);
      if (!res.ok) {
        if (native && res.status === 401) await writeRefreshToken(null);
        return null;
      }
      const s = (await res.json()) as S;
      accessToken = s.accessToken;
      if (native && s.refreshToken) await writeRefreshToken(s.refreshToken);
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
    if (native) headers["X-Client"] = "mobile";

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        credentials: native ? "omit" : "include",
        signal: opts.signal,
      });
    } catch {
      throw new ApiError(0, "network", "Can't reach Gustlog. Check your internet connection and try again.");
    }

    if (res.status === 401 && !retried && !path.startsWith(authPrefix)) {
      if (await refresh()) return request<T>(path, opts, true);
      accessToken = null;
      onSessionEnd?.();
    }

    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 402 && (data?.code === "SUBSCRIPTION_REQUIRED" || data?.code === "subscription_expired")) {
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/billing") && !window.location.pathname.startsWith("/admin")) {
          window.location.href = "/billing";
        }
      }
      throw new ApiError(res.status, data?.code ?? "unknown", data?.message ?? "Something went wrong. Please try again.", data?.fields);
    }
    return data as T;
  }

  /** Fetches a protected file (e.g. an encrypted ID image) as a Blob using the session token. */
  async function blob(path: string, retried = false): Promise<Blob> {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: native ? "omit" : "include",
    });
    if (res.status === 401 && !retried && (await refresh())) return blob(path, true);
    if (!res.ok) throw new ApiError(res.status, "file", "Couldn't load the image.");
    return res.blob();
  }

  /** Starts a session from a login or invite response. */
  async function adopt(s: S) {
    accessToken = s.accessToken;
    if (native && s.refreshToken) await writeRefreshToken(s.refreshToken);
  }

  async function logout() {
    const body = native ? { refreshToken: await readRefreshToken() } : undefined;
    await request(`${authPrefix}/logout`, { method: "POST", body }).catch(() => {});
    accessToken = null;
    if (native) await writeRefreshToken(null);
  }

  return {
    request,
    blob,
    refresh,
    adopt,
    logout,
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
export type Session = { accessToken: string; refreshToken?: string; user: User };

/** Hotel-staff client. */
export const hotel = createClient<Session>("/auth", isNative);
export const api = hotel.request;

/** Maps API field errors onto a react-hook-form instance. Returns true if any were applied. */
export function applyFieldErrors(err: unknown, setError: (name: never, e: { message: string }) => void): boolean {
  if (!(err instanceof ApiError) || !err.fields) return false;
  for (const [k, v] of Object.entries(err.fields)) setError(k as never, { message: v });
  return true;
}
