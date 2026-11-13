import clsx from "clsx";
import { ChevronRight, Download } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Spinner } from "../components/ui";
import { rupees } from "../lib/format";
import { useCurrentProperty } from "../lib/property";
import { addDays, hotelToday } from "../lib/reservations";
import { downloadCsv, rupeeNumber, useReport, type ReportInvoice } from "../lib/reports";
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

const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

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
          <p className={clsx("text-xs", due > 0 ? "text-danger" : "text-ready")}>{due > 0 ? (showDue ? "Due" : `Due ${rupees(due)}`) : "Paid"}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

/** Numbers for a date range: money, occupancy, GST, who still owes, and every invoice. */
export function ReportsPage() {
  const property = useCurrentProperty();
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState<[string, string]>(() => rangeFor("month"));
  const [from, to] = preset === "custom" ? custom : rangeFor(preset);
  const q = useReport(property.id, from, to);
  const r = q.data;

  const exportInvoices = () =>
    r &&
    downloadCsv(`invoices-${from}-to-${to}.csv`, [
      ["Invoice no", "Date", "Guest", "Company", "Room", "Total (INR)", "Paid (INR)", "Due (INR)"],
      ...r.invoices.map((v) => [v.number, v.issuedAt.slice(0, 10), v.guest, v.billTo, v.room, rupeeNumber(v.total), rupeeNumber(v.paid), rupeeNumber(v.total - v.paid)]),
    ]);
  const exportGst = () =>
    r &&
    downloadCsv(`gst-summary-${from}-to-${to}.csv`, [
      ["Month", "GST rate %", "Invoices", "Taxable value (INR)", "CGST (INR)", "SGST (INR)"],
      ...r.gst.map((g) => [g.month, g.rateBp / 100, g.invoices, rupeeNumber(g.taxable), rupeeNumber(g.cgst), rupeeNumber(g.sgst)]),
    ]);

  return (
    <>
      <PageHeader title="Reports" description="Money, occupancy and GST for the dates you pick." />

      <div className="mb-5 flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              if (p.id === "custom") setCustom([from, to]);
              setPreset(p.id);
            }}
            className={clsx("rounded-full border px-3.5 py-1.5 text-sm", preset === p.id ? "border-brand-700 bg-brand-50 font-semibold text-brand-800" : "border-line-strong hover:bg-sand")}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex w-full flex-wrap gap-3 pt-2">
            <Field label="From">{(id) => <Input id={id} type="date" max={custom[1]} value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} />}</Field>
            <Field label="To">{(id) => <Input id={id} type="date" min={custom[0]} value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} />}</Field>
          </div>
        )}
      </div>

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
                      <span>{payModeLabel[p.mode] ?? p.mode}</span>
                      <span className="tabular font-medium">{rupees(p.amount)}</span>
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
                <p className="px-4 py-4 text-sm text-muted">No GST invoices in these dates.</p>
              ) : (
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-right text-xs tracking-wider text-muted uppercase">
                      <th className="px-4 py-2 text-left font-semibold">Month</th>
                      <th className="px-2 py-2 font-semibold">Rate</th>
                      <th className="px-2 py-2 font-semibold">Taxable</th>
                      <th className="px-2 py-2 font-semibold">CGST</th>
                      <th className="px-4 py-2 font-semibold">SGST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.gst.map((g) => (
                      <tr key={g.month + g.rateBp} className="tabular text-right">
                        <td className="px-4 py-2 text-left">{monthLabel(g.month)}</td>
                        <td className="px-2 py-2">{g.rateBp / 100}%</td>
                        <td className="px-2 py-2">{rupees(g.taxable)}</td>
                        <td className="px-2 py-2">{rupees(g.cgst)}</td>
                        <td className="px-4 py-2">{rupees(g.sgst)}</td>
                      </tr>
                    ))}
                    <tr className="tabular border-t border-line-strong text-right font-semibold">
                      <td className="px-4 py-2 text-left" colSpan={2}>Total</td>
                      <td className="px-2 py-2">{rupees(r.taxable)}</td>
                      <td className="px-2 py-2">{rupees(r.cgst)}</td>
                      <td className="px-4 py-2">{rupees(r.sgst)}</td>
                    </tr>
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
            <p className="mt-2 text-xs text-muted">Tap an invoice to print it, save it as a PDF, or send it on WhatsApp.</p>
          </section>
        </div>
      )}
    </>
  );
}
