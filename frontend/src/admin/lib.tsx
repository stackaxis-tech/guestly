import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "../lib/api";
import type { Property } from "../lib/property";

export type Admin = { id: string; name: string; email: string };
type AdminSession = { accessToken: string; admin: Admin };

export const adminClient = createClient<AdminSession>("/admin/auth");
export const adminApi = adminClient.request;

/* ---------- Auth ---------- */

type State = { status: "loading" | "signedOut"; admin: null } | { status: "signedIn"; admin: Admin };
type Ctx = State & { login: (email: string, password: string) => Promise<void>; logout: () => Promise<void> };

const AdminAuthContext = createContext<Ctx | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading", admin: null });
  const qc = useQueryClient();

  const signedOut = useCallback(() => {
    adminClient.setToken(null);
    qc.clear();
    setState({ status: "signedOut", admin: null });
  }, [qc]);

  useEffect(() => {
    adminClient.onSessionEnd(signedOut);
    adminClient.refresh().then((s) => setState(s ? { status: "signedIn", admin: s.admin } : { status: "signedOut", admin: null }));
  }, [signedOut]);

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      login: async (email, password) => {
        const s = await adminApi<AdminSession>("/admin/auth/login", { method: "POST", body: { email, password } });
        adminClient.setToken(s.accessToken);
        setState({ status: "signedIn", admin: s.admin });
      },
      logout: async () => {
        await adminApi("/admin/auth/logout", { method: "POST" }).catch(() => {});
        signedOut();
      },
    }),
    [state, signedOut],
  );
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return ctx;
}

/* ---------- Types ---------- */

export type ClientState = "active" | "trial" | "expiring" | "overdue" | "suspended";

export type ClientRow = {
  id: string;
  name: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  status: "active" | "suspended";
  state: ClientState;
  propertyCount: number;
  nextRenewal: string | null;
  lastPaymentOn: string | null;
  totalPaid: number;
  logoUrl: string;
  createdAt: string;
};

export type Payment = {
  id: string;
  clientId: string;
  clientName: string;
  propertyId: string;
  propertyName: string;
  amount: number;
  mode: "upi" | "bank" | "cash" | "other";
  reference: string;
  paidOn: string;
  receiptNo: string;
  periodFrom: string;
  periodTo: string;
  notes: string;
  recordedBy: string;
  createdAt: string;
};

export type ClientUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  activated: boolean;
  createdAt: string;
};

export type ClientDetail = Omit<ClientRow, "propertyCount" | "nextRenewal" | "lastPaymentOn" | "logoUrl"> & {
  billingGstin: string;
  notes: string;
  properties: Property[];
  users: ClientUser[];
  payments: Payment[];
};

export type Renewal = {
  propertyId: string;
  propertyName: string;
  clientId: string;
  clientName: string;
  endsOn: string;
  amount: number;
  state: "trial" | "active" | "grace" | "expired";
  daysLeft: number;
};

export type Dashboard = {
  counts: Record<"total" | "active" | "trial" | "expiring" | "overdue" | "suspended", number>;
  properties: number;
  revenueThisMonth: number;
  revenueThisFY: number;
  financialYear: string;
  renewals: Renewal[];
  recentPayments: Payment[];
};

export type AuditEntry = {
  id: number;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

/* ---------- Queries ---------- */

export const useDashboard = () => useQuery({ queryKey: ["admin", "dashboard"], queryFn: () => adminApi<Dashboard>("/admin/dashboard") });
export const useClients = () => useQuery({ queryKey: ["admin", "clients"], queryFn: () => adminApi<ClientRow[]>("/admin/clients") });
export const useClient = (id: string) =>
  useQuery({ queryKey: ["admin", "client", id], queryFn: () => adminApi<ClientDetail>(`/admin/clients/${id}`) });
export const usePayments = () => useQuery({ queryKey: ["admin", "payments"], queryFn: () => adminApi<Payment[]>("/admin/payments") });
export const useAudit = () => useQuery({ queryKey: ["admin", "audit"], queryFn: () => adminApi<AuditEntry[]>("/admin/audit") });

/** After any admin write, everything in the console may have changed. */
export function useInvalidateAdmin() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["admin"] });
}

/* ---------- Display helpers ---------- */

export const clientStateMeta: Record<ClientState, { label: string; className: string; dot: string }> = {
  active: { label: "Active", className: "bg-ready-bg text-ready", dot: "bg-ready" },
  trial: { label: "Trial", className: "bg-teal-50 text-teal-700", dot: "bg-teal-400" },
  expiring: { label: "Renewing soon", className: "bg-marigold-50 text-marigold-700", dot: "bg-marigold-400" },
  overdue: { label: "Overdue", className: "bg-danger-bg text-danger", dot: "bg-danger" },
  suspended: { label: "Suspended", className: "bg-maintenance-bg text-maintenance", dot: "bg-maintenance" },
};

export const billingStateMeta: Record<string, { label: string; className: string }> = {
  trial: { label: "Trial", className: "bg-teal-50 text-teal-700" },
  active: { label: "Active", className: "bg-ready-bg text-ready" },
  grace: { label: "In grace period", className: "bg-marigold-50 text-marigold-700" },
  expired: { label: "Expired · read-only", className: "bg-danger-bg text-danger" },
};

export const modeLabel: Record<Payment["mode"], string> = { upi: "UPI", bank: "Bank transfer", cash: "Cash", other: "Other" };

export const planLabel = (plan: string, months: number) =>
  plan === "annual" ? "Annual" : plan === "monthly" ? "Monthly" : `Every ${months} months`;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** WhatsApp share link for an invite (opens WhatsApp with the message prefilled). */
export function whatsappInviteLink(phone: string, name: string, url: string): string {
  const text = `Hi ${name}, your Guestly account is ready. Set your password here: ${url}`;
  const digits = phone.replace(/\D/g, "");
  const to = digits.length === 10 ? "91" + digits : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
