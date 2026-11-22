import clsx from "clsx";
import { BarChart3, ChevronRight, Download, UserCheck, Users } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Spinner } from "../components/ui";
import { roleLabel } from "../lib/auth";
import { rupees } from "../lib/format";
import { useCurrentProperty } from "../lib/property";
import { addDays, hotelToday } from "../lib/reservations";
import {
  downloadCsv,
  rupeeNumber,
  useAttendanceReport,
  useReport,
  type ReportInvoice,
} from "../lib/reports";
import { payModeLabel } from "../lib/stays";

type Preset = "month" | "last-month" | "week" | "custom";

function rangeFor(p: Exclude<Preset, "custom">): [string, string] {
  const today = hotelToday();
  if (p === "week") return [addDays(today, -6), today];
  if (p === "month") return [`${today.slice(0, 8)}01`, today];
  // Last month: the day before this month's first day is the last day of last month.
  const last = addDays(`${today.slice(0, 8)}01`, -1);
  return [`${last.slice(0, 8)}01`, last];
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "week", label: "Last 7 days" },
  { id: "custom", label: "Custom" },
];

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-xs font-semibold tracking-wider text-muted uppercase">{label}</p>
      <p className="tabular font-display mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}

function InvoiceRow({ v, showDue }: { v: ReportInvoice; showDue?: boolean }) {
  const due = v.total - v.paid;
  return (
    <li>
      <Link to={`/stays/${v.stayId}/invoice`} className="flex items-center gap-3 px-4 py-3 hover:bg-sand">
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate font-medium">
            {v.guest}
            {v.billTo && <span className="font-normal text-muted"> · {v.billTo}</span>}
          </p>
          <p className="truncate text-xs text-muted">
            {v.number} · {dayLabel(v.issuedAt)}
            {v.room && ` · Room ${v.room}`}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="tabular font-semibold">{rupees(showDue ? due : v.total)}</p>
          <p className={clsx("text-xs", due > 0 ? "text-danger" : "text-ready")}>
            {due > 0 ? (showDue ? "Due" : `Due ${rupees(due)}`) : "Paid"}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

export function ReportsPage() {
  const property = useCurrentProperty();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "attendance" ? "attendance" : "financial";
  const [tab, setTab] = useState<"financial" | "attendance">(initialTab);
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState<[string, string]>(() => rangeFor("month"));
  const [from, to] = preset === "custom" ? custom : rangeFor(preset);

  const q = useReport(property.id, from, to);
  const r = q.data;

  const attQ = useAttendanceReport(property.id, from, to);
  const att = attQ.data;

  const exportInvoices = () =>
    r &&
    downloadCsv(`invoices-${from}-to-${to}.csv`, [
      ["Invoice no", "Date", "Guest", "Company", "Room", "Total (INR)", "Paid (INR)", "Due (INR)"],
      ...r.invoices.map((v) => [
        v.number,
        v.issuedAt.slice(0, 10),
        v.guest,
        v.billTo,
        v.room,
        rupeeNumber(v.total),
        rupeeNumber(v.paid),
        rupeeNumber(v.total - v.paid),
      ]),
    ]);

  const exportGst = () =>
    r &&
    downloadCsv(`gst-summary-${from}-to-${to}.csv`, [
      ["Month", "GST rate %", "Invoices", "Taxable value (INR)", "CGST (INR)", "SGST (INR)"],
      ...r.gst.map((g) => [g.month, g.rateBp / 100, g.invoices, rupeeNumber(g.taxable), rupeeNumber(g.cgst), rupeeNumber(g.sgst)]),
    ]);

  const exportAttendance = () =>
    att &&
    downloadCsv(`staff-attendance-${from}-to-${to}.csv`, [
      ["Date", "Staff Name", "Role", "Email", "Phone", "Clock In", "Clock Out", "Status", "Notes"],
      ...att.records.map((a) => [
        a.date,
        a.staffName,
        a.staffRole,
        a.staffEmail,
        a.staffPhone,
        formatClock(a.clockInAt),
        a.clockOutAt ? formatClock(a.clockOutAt) : "On duty",
        a.status,
        a.notes,
      ]),
    ]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Business metrics, financial summaries, and staff attendance records."
      />

      {/* Report Type Tabs */}
      <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "financial"}
          onClick={() => {
            setTab("financial");
            setSearchParams({});
          }}
          className={clsx(
            "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
            tab === "financial" ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink",
          )}
        >
          <BarChart3 className="size-4" />
          Financial & Occupancy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "attendance"}
          onClick={() => {
            setTab("attendance");
            setSearchParams({ tab: "attendance" });
          }}
          className={clsx(
            "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
            tab === "attendance" ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink",
          )}
        >
          <UserCheck className="size-4" />
          Staff Attendance
        </button>
      </div>

      {/* Date Presets */}
      <div className="mb-6 flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              if (p.id === "custom") setCustom([from, to]);
              setPreset(p.id);
            }}
            className={clsx(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              preset === p.id ? "border-brand-700 bg-brand-50 font-semibold text-brand-800" : "border-line-strong hover:bg-sand",
            )}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex w-full flex-wrap gap-3 pt-2">
            <Field label="From">
              {(id) => <Input id={id} type="date" max={custom[1]} value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} />}
            </Field>
            <Field label="To">
              {(id) => <Input id={id} type="date" min={custom[0]} value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} />}
            </Field>
          </div>
        )}
      </div>

      {/* ---------- Tab 1: Financial & Occupancy ---------- */}
      {tab === "financial" && (
        <>
          {q.isLoading ? (
            <Spinner />
          ) : q.error || !r ? (
            <ErrorNote message={q.error?.message ?? "Couldn't load the report."} onRetry={() => q.refetch()} />
          ) : (
            <div className="flex flex-col gap-8">
              <p className="-mt-2 text-sm text-muted">
                {dayLabel(`${r.from}T00:00:00+05:30`)} to {dayLabel(`${r.to}T00:00:00+05:30`)} · {r.days} {r.days === 1 ? "day" : "days"}
              </p>

              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="Invoiced" value={rupees(r.invoiced)} hint={`${r.invoiceCount} invoice${r.invoiceCount === 1 ? "" : "s"}`} />
                <Tile label="Collected" value={rupees(r.collected)} hint="Payments received, after refunds" />
                <Tile label="Occupancy" value={`${r.occupancyPct}%`} hint={`${r.roomNights} room-nights of ${r.rooms * r.days}`} />
                <Tile label="Average rate" value={rupees(r.avgRate)} hint="Per night, before GST" />
              </section>

              <section>
                <SectionTitle title="Payments by method" />
                <Card>
                  {r.payments.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted">No payments in these dates.</p>
                  ) : (
                    <ul className="divide-y divide-line text-sm">
                      {r.payments.map((p) => (
                        <li key={p.mode} className="flex justify-between px-4 py-2.5">
                          <span className="text-muted">{payModeLabel[p.mode]}</span>
                          <span className="tabular font-semibold">{rupees(p.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </section>

              <section>
                <SectionTitle
                  title="GST summary"
                  action={
                    r.gst.length > 0 && (
                      <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={exportGst}>
                        CSV
                      </Button>
                    )
                  }
                />
                <Card className="overflow-x-auto">
                  {r.gst.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted">No tax recorded in these dates.</p>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
                        <tr>
                          <th className="px-4 py-2.5">Month</th>
                          <th className="px-4 py-2.5">Rate</th>
                          <th className="px-4 py-2.5 text-right">Invoices</th>
                          <th className="px-4 py-2.5 text-right">Taxable</th>
                          <th className="px-4 py-2.5 text-right">CGST</th>
                          <th className="px-4 py-2.5 text-right">SGST</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line tabular">
                        {r.gst.map((g) => (
                          <tr key={`${g.month}-${g.rateBp}`} className="hover:bg-sand/30">
                            <td className="px-4 py-2.5 font-medium">{monthLabel(g.month)}</td>
                            <td className="px-4 py-2.5 text-muted">{g.rateBp / 100}%</td>
                            <td className="px-4 py-2.5 text-right text-muted">{g.invoices}</td>
                            <td className="px-4 py-2.5 text-right">{rupees(g.taxable)}</td>
                            <td className="px-4 py-2.5 text-right text-muted">{rupees(g.cgst)}</td>
                            <td className="px-4 py-2.5 text-right text-muted">{rupees(g.sgst)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              </section>

              <section>
                <SectionTitle title="Still to collect" />
                <Card>
                  {r.dues.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted">Nobody owes anything. Every invoice is paid.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {r.dues.map((v) => (
                        <InvoiceRow key={v.id} v={v} showDue />
                      ))}
                    </ul>
                  )}
                </Card>
              </section>

              <section>
                <SectionTitle
                  title={`Invoices (${r.invoices.length})`}
                  action={
                    r.invoices.length > 0 && (
                      <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={exportInvoices}>
                        CSV
                      </Button>
                    )
                  }
                />
                <Card>
                  {r.invoices.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted">No invoices in these dates.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {r.invoices.map((v) => (
                        <InvoiceRow key={v.id} v={v} />
                      ))}
                    </ul>
                  )}
                </Card>
              </section>
            </div>
          )}
        </>
      )}

      {/* ---------- Tab 2: Staff Attendance ---------- */}
      {tab === "attendance" && (
        <div>
          {attQ.isLoading ? (
            <Spinner />
          ) : attQ.error || !att ? (
            <ErrorNote message={attQ.error?.message ?? "Couldn't load staff attendance."} onRetry={() => attQ.refetch()} />
          ) : (
            <div className="flex flex-col gap-6">
              <p className="-mt-2 text-sm text-muted">
                {dayLabel(`${from}T00:00:00+05:30`)} to {dayLabel(`${to}T00:00:00+05:30`)} · {att.records.length} records found
              </p>

              {/* Attendance Summary */}
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Tile label="Total Staff Members" value={String(att.summary.totalStaff)} hint="Registered on this property" />
                <Tile label="Present Today" value={String(att.summary.presentToday)} hint={`For ${hotelToday()}`} />
                <Tile label="Attendance Logged" value={String(att.summary.totalRecords)} hint="Records in selected period" />
              </section>

              {/* Records Table */}
              <section>
                <SectionTitle
                  title="Staff Attendance Records"
                  action={
                    att.records.length > 0 && (
                      <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={exportAttendance}>
                        CSV
                      </Button>
                    )
                  }
                />

                <Card className="overflow-x-auto">
                  {att.records.length === 0 ? (
                    <div className="px-5 py-8 text-center">
                      <EmptyState
                        icon={<Users className="size-6" />}
                        title="No attendance records in this period"
                        body="Staff attendance logs appear here automatically as staff clock in or work."
                      />
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Staff Member</th>
                          <th className="px-4 py-3">Role</th>
                          <th className="px-4 py-3">Clock In</th>
                          <th className="px-4 py-3">Clock Out</th>
                          <th className="px-4 py-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {att.records.map((a) => (
                          <tr key={a.id} className="hover:bg-sand/30 transition-colors">
                            <td className="px-4 py-3 font-medium text-ink tabular">{dayLabel(`${a.date}T00:00:00+05:30`)}</td>
                            <td className="px-4 py-3">
                              <span className="block font-semibold text-ink">{a.staffName}</span>
                              <span className="block text-xs text-muted">{a.staffEmail || a.staffPhone}</span>
                            </td>
                            <td className="px-4 py-3 text-ink-soft capitalize">
                              <span className="inline-flex items-center rounded-md bg-sand px-2 py-0.5 text-xs font-medium text-ink">
                                {roleLabel[a.staffRole as keyof typeof roleLabel] ?? a.staffRole}
                              </span>
                            </td>
                            <td className="px-4 py-3 tabular text-ink-soft font-mono text-xs">{formatClock(a.clockInAt)}</td>
                            <td className="px-4 py-3 tabular text-ink-soft font-mono text-xs">
                              {a.clockOutAt ? formatClock(a.clockOutAt) : <span className="text-ready font-medium">On duty</span>}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span
                                className={clsx(
                                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                                  a.status === "present" ? "bg-ready-bg text-ready" : a.status === "half_day" ? "bg-accent-50 text-accent-700" : "bg-danger-bg text-danger",
                                )}
                              >
                                {a.status.replace("_", " ")}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              </section>
            </div>
          )}
        </div>
      )}
    </>
  );
}
