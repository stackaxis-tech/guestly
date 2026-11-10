import clsx from "clsx";
import { AlertTriangle, Building2, ChevronRight, Plus, Search, Wallet } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PropertyLogo } from "../components/PropertyLogo";
import { Button, Card, EmptyState, ErrorNote, Input, PageHeader, Spinner } from "../components/ui";
import { rupees } from "../lib/format";
import {
  clientStateMeta,
  formatDate,
  modeLabel,
  relativeDays,
  useAudit,
  useClients,
  useDashboard,
  usePayments,
  type ClientState,
  type Payment,
} from "./lib";

export function StateBadge({ state }: { state: ClientState }) {
  const m = clientStateMeta[state];
  return <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", m.className)}>{m.label}</span>;
}

function Stat({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: string; tone?: string; to?: string }) {
  const body = (
    <Card className={clsx("h-full px-4 py-4", to && "transition-colors hover:border-line-strong")}>
      <div className="flex items-center gap-2">
        {tone && <span className={clsx("size-2 rounded-full", tone)} aria-hidden />}
        <p className="text-sm font-medium text-ink-soft">{label}</p>
      </div>
      <p className="tabular mt-2 font-display text-3xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

/* ---------- Dashboard ---------- */

export function AdminDashboard() {
  const q = useDashboard();
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const attention = d.renewals.filter((r) => r.state === "grace" || r.state === "expired");
  const upcoming = d.renewals.filter((r) => r.state !== "grace" && r.state !== "expired");

  return (
    <>
      <PageHeader eyebrow="Guestlog console"
        title="Dashboard"
        description={`${d.counts.total} clients · ${d.properties} properties`}
        actions={
          <Link to="/admin/clients/new">
            <Button icon={<Plus className="size-4" />}>New client</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-ink bg-ink! px-5 py-5 text-white">
          <p className="text-sm text-white/70">Collected this month</p>
          <p className="tabular mt-1 font-display text-4xl font-bold">{rupees(d.revenueThisMonth)}</p>
        </Card>
        <Card className="px-5 py-5">
          <p className="text-sm text-muted">Collected in FY {d.financialYear}</p>
          <p className="tabular mt-1 font-display text-4xl font-bold">{rupees(d.revenueThisFY)}</p>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active" value={d.counts.active} tone={clientStateMeta.active.dot} to="/admin/clients?state=active" />
        <Stat label="On trial" value={d.counts.trial} tone={clientStateMeta.trial.dot} to="/admin/clients?state=trial" />
        <Stat label="Renewing in 30 days" value={d.counts.expiring} tone={clientStateMeta.expiring.dot} to="/admin/clients?state=expiring" />
        <Stat label="Overdue" value={d.counts.overdue} tone={clientStateMeta.overdue.dot} to="/admin/clients?state=overdue" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold">Renewals</h2>
            <p className="text-sm text-muted">Overdue properties first, then everything due in the next 30 days.</p>
          </div>
          {d.renewals.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">Nothing due in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-line">
              {[...attention, ...upcoming].map((r) => (
                <li key={r.propertyId}>
                  <Link to={`/admin/clients/${r.clientId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sand/60">
                    {(r.state === "grace" || r.state === "expired") && <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.propertyName}</span>
                      <span className="block truncate text-xs text-muted">{r.clientName}</span>
                    </span>
                    <span className="text-right">
                      <span className={clsx("block text-xs font-semibold", r.state === "grace" || r.state === "expired" ? "text-danger" : "text-accent-700")}>
                        {r.state === "expired" || r.state === "grace"
                          ? `Ended ${relativeDays(r.daysLeft)}`
                          : `${r.state === "trial" ? "Trial ends" : "Renews"} ${relativeDays(r.daysLeft)}`}
                      </span>
                      <span className="tabular block text-xs text-muted">{rupees(r.amount)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold">Recent payments</h2>
            <Link to="/admin/payments" className="text-sm font-semibold text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          {d.recentPayments.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.clientName}</span>
                    <span className="block truncate text-xs text-muted">
                      {formatDate(p.paidOn)} · {modeLabel[p.mode]}
                    </span>
                  </span>
                  <span className="tabular font-semibold">{rupees(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/* ---------- Clients ---------- */

const filters: { key: ClientState | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "trial", label: "Trial" },
  { key: "expiring", label: "Renewing soon" },
  { key: "overdue", label: "Overdue" },
  { key: "suspended", label: "Suspended" },
];

export function ClientsPage() {
  const q = useClients();
  const initial = (new URLSearchParams(location.search).get("state") as ClientState | null) ?? "all";
  const [state, setState] = useState<ClientState | "all">(initial);
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: q.data?.length ?? 0 };
    for (const x of q.data ?? []) c[x.state] = (c[x.state] ?? 0) + 1;
    return c;
  }, [q.data]);

  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter(
      (c) =>
        (state === "all" || c.state === state) &&
        (!s || `${c.name} ${c.contactName} ${c.contactPhone} ${c.contactEmail}`.toLowerCase().includes(s)),
    );
  }, [q.data, state, search]);

  return (
    <>
      <PageHeader eyebrow="Guestlog console"
        title="Clients"
        description="Hotels and homestays using Guestlog."
        actions={
          <Link to="/admin/clients/new">
            <Button icon={<Plus className="size-4" />}>New client</Button>
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email"
            className="pl-9"
            aria-label="Search clients"
          />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter by status">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setState(f.key)}
              aria-pressed={state === f.key}
              className={clsx(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                state === f.key ? "border-ink bg-ink text-white" : "border-line bg-paper text-ink-soft hover:border-line-strong hover:bg-sand",
              )}
            >
              {f.label} <span className={clsx("tabular", state === f.key ? "text-white/70" : "text-muted")}>{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-6" />}
            title={q.data!.length === 0 ? "No clients yet" : "No clients match"}
            body={q.data!.length === 0 ? "Create your first hotel client to get them started on Guestlog." : "Try a different search or filter."}
            action={
              q.data!.length === 0 && (
                <Link to="/admin/clients/new">
                  <Button>New client</Button>
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_24px] gap-4 border-b border-line bg-sand/50 px-5 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase md:grid">
            <span>Client</span>
            <span>Status</span>
            <span>Next renewal</span>
            <span className="text-right">Total paid</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {list.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/admin/clients/${c.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-sand/60 md:grid-cols-[2fr_1fr_1fr_1fr_24px]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <PropertyLogo name={c.name} url={c.logoUrl} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {c.contactName || "—"} · {c.contactPhone} · {c.propertyCount} {c.propertyCount === 1 ? "property" : "properties"}
                      </span>
                    </span>
                  </span>
                  <span>
                    <StateBadge state={c.state} />
                  </span>
                  <span className="hidden text-sm text-ink-soft md:block">{formatDate(c.nextRenewal)}</span>
                  <span className="tabular hidden text-right text-sm font-semibold md:block">{rupees(c.totalPaid)}</span>
                  <ChevronRight className="hidden size-4 text-muted md:block" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/* ---------- Payments ---------- */

export function PaymentsTable({ payments, showClient = true }: { payments: Payment[]; showClient?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line bg-sand/50 text-left text-xs font-semibold tracking-wide text-muted uppercase">
            <th className="px-5 py-2.5 font-semibold">Paid on</th>
            {showClient && <th className="px-3 py-2.5 font-semibold">Client</th>}
            <th className="px-3 py-2.5 font-semibold">Property</th>
            <th className="px-3 py-2.5 font-semibold">Method</th>
            <th className="px-3 py-2.5 font-semibold">Covers</th>
            <th className="px-3 py-2.5 font-semibold">Receipt</th>
            <th className="px-5 py-2.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {payments.map((p) => (
            <tr key={p.id} className="align-top">
              <td className="px-5 py-3 whitespace-nowrap">{formatDate(p.paidOn)}</td>
              {showClient && (
                <td className="px-3 py-3">
                  <Link to={`/admin/clients/${p.clientId}`} className="font-medium text-brand-700 hover:underline">
                    {p.clientName}
                  </Link>
                </td>
              )}
              <td className="px-3 py-3">{p.propertyName}</td>
              <td className="px-3 py-3">
                {modeLabel[p.mode]}
                {p.reference && <span className="block font-mono text-xs text-muted">{p.reference}</span>}
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-muted">
                {formatDate(p.periodFrom)} – {formatDate(p.periodTo)}
              </td>
              <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">{p.receiptNo}</td>
              <td className="tabular px-5 py-3 text-right font-semibold">{rupees(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminPaymentsPage() {
  const q = usePayments();
  const total = (q.data ?? []).reduce((s, p) => s + p.amount, 0);
  return (
    <>
      <PageHeader eyebrow="Guestlog console" title="Payments" description="Every subscription payment recorded from clients." />
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />
      ) : q.data!.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Wallet className="size-6" />}
            title="No payments yet"
            body="Open a client and use “Record payment” when they pay by UPI, bank transfer, or cash."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="text-sm text-muted">{q.data!.length} {q.data!.length === 1 ? "payment" : "payments"}</span>
            <span className="tabular font-semibold">{rupees(total)} total</span>
          </div>
          <PaymentsTable payments={q.data!} />
        </Card>
      )}
    </>
  );
}

/* ---------- Activity ---------- */

const actionLabel: Record<string, string> = {
  "client.created": "created client",
  "client.updated": "updated client details for",
  "client.suspended": "suspended",
  "client.reactivated": "reactivated",
  "property.created": "added property",
  "property.updated": "updated property",
  "property.logo_updated": "uploaded a new logo for",
  "property.logo_removed": "removed the logo of",
  "subscription.updated": "changed the plan for",
  "payment.recorded": "recorded a payment for",
  "user.invite_resent": "sent a new invite link for",
};

export function ActivityPage() {
  const q = useAudit();
  return (
    <>
      <PageHeader eyebrow="Guestlog console" title="Activity" description="Every change made in the Guestlog console." />
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />
      ) : (
        <Card>
          {q.data!.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {q.data!.map((e) => {
                const detail = e.details ?? {};
                const extra =
                  e.action === "payment.recorded"
                    ? `${rupees(Number(detail.amount ?? 0))} · ${String(detail.receipt ?? "")}`
                    : typeof detail.reason === "string" && detail.reason
                      ? `Reason: ${detail.reason}`
                      : "";
                return (
                  <li key={e.id} className="flex gap-3 px-5 py-3 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-400" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{e.adminName}</span> {actionLabel[e.action] ?? e.action}{" "}
                      <span className="font-semibold">{e.targetName || "a deleted record"}</span>
                      {extra && <span className="block text-xs text-muted">{extra}</span>}
                    </span>
                    <time className="shrink-0 text-xs text-muted" dateTime={e.createdAt}>
                      {new Date(e.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
