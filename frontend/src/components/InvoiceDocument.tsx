import clsx from "clsx";
import { rupees } from "../lib/format";
import { foodPlanLabel, payModeLabel, type Invoice } from "../lib/stays";

const dayFmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const timeFmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
// Line dates arrive as YYYY-MM-DD (hotel time), so format them without shifting the day.
const lineDay = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
};
const pct = (bp: number) => `${bp / 100}%`;

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * The guest invoice. One standard layout for every hotel: the only branding is the hotel's own
 * logo and details. Everything on it comes from the frozen copy saved when the invoice was
 * created, except the payments, which are live. Used on the staff screen and the guest's share link.
 */
export function InvoiceDocument({ invoice, copy }: { invoice: Invoice; copy?: string }) {
  const { doc } = invoice;
  const s = doc.seller;
  const taxed = doc.title === "TAX INVOICE";
  const guests = `${doc.stay.adults} adult${doc.stay.adults === 1 ? "" : "s"}${doc.stay.children > 0 ? `, ${doc.stay.children} child${doc.stay.children === 1 ? "" : "ren"}` : ""}`;
  const label = copy ?? invoice.copy;

  return (
    <article className="invoice mx-auto w-full max-w-[210mm] rounded-xl border border-line bg-paper p-5 text-ink sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0">
      {/* Header: the hotel on the left, the document on the right */}
      <header className="flex flex-col gap-5 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {invoice.logoUrl && <img src={invoice.logoUrl} alt="" className="size-16 shrink-0 rounded-md object-contain" />}
          <div className="text-sm">
            <h1 className="font-display text-lg leading-tight font-bold">{s.legalName}</h1>
            {s.tradeName && s.tradeName !== s.legalName && <p className="text-muted">Trading as {s.tradeName}</p>}
            {s.addressLines.map((l) => (
              <p key={l} className="text-ink-soft">{l}</p>
            ))}
            {(s.phone || s.email) && <p className="text-ink-soft">{[s.phone, s.email].filter(Boolean).join(" · ")}</p>}
            {s.gstin && <p className="mt-1 font-medium">GSTIN: <span className="font-mono">{s.gstin}</span></p>}
          </div>
        </div>
        <div className="sm:text-right">
          <p className="font-display text-xl font-bold tracking-wide">{doc.title}</p>
          {label && <p className="mt-0.5 text-xs font-semibold tracking-widest text-muted">{label}</p>}
          <dl className="mt-3 space-y-1">
            <Meta label="Invoice no.">{invoice.number}</Meta>
            <Meta label="Date">{dayFmt(invoice.issuedAt)}</Meta>
          </dl>
        </div>
      </header>

      {/* Who it is for, and the stay */}
      <section className="grid gap-5 border-b border-line py-5 sm:grid-cols-2">
        <div className="text-sm">
          <h2 className="mb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">Bill to</h2>
          <p className="font-semibold">{doc.billTo.name}</p>
          {doc.billTo.address && <p className="text-ink-soft">{doc.billTo.address}</p>}
          {doc.billTo.phone && <p className="text-ink-soft">{doc.billTo.phone}</p>}
          {doc.billTo.gstin && <p className="mt-1">GSTIN: <span className="font-mono">{doc.billTo.gstin}</span></p>}
          {(doc.billTo.state || doc.billTo.stateCode) && <p className="text-ink-soft">State: {[doc.billTo.state, doc.billTo.stateCode && `(${doc.billTo.stateCode})`].filter(Boolean).join(" ")}</p>}
        </div>
        <dl className="space-y-1">
          <Meta label="Guest">{doc.guestName}</Meta>
          <Meta label="Room">{doc.stay.roomNumber} · {doc.stay.roomType}</Meta>
          <Meta label="Check-in">{timeFmt(doc.stay.checkInAt)}</Meta>
          <Meta label="Check-out">{timeFmt(doc.stay.checkOutAt)}</Meta>
          <Meta label="Nights">{doc.stay.nights}</Meta>
          <Meta label="Guests">{guests}</Meta>
          <Meta label="Meal plan">{foodPlanLabel[doc.stay.foodPlan] ?? doc.stay.foodPlan}</Meta>
          {taxed && s.state && <Meta label="Place of supply">{s.state}{s.stateCode && ` (${s.stateCode})`}</Meta>}
        </dl>
      </section>

      {/* Charges */}
      <section className="overflow-x-auto py-5">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-line-strong text-left text-xs font-semibold tracking-wider text-muted uppercase">
              <th className="py-2 pr-3 font-semibold">Date</th>
              <th className="py-2 pr-3 font-semibold">Description</th>
              <th className="py-2 pr-3 font-semibold">SAC</th>
              <th className="py-2 pr-3 text-right font-semibold">Qty</th>
              <th className="py-2 pr-3 text-right font-semibold">Rate</th>
              {taxed && <th className="py-2 pr-3 text-right font-semibold">GST</th>}
              <th className="py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {doc.lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="tabular py-2.5 pr-3 whitespace-nowrap text-ink-soft">{lineDay(l.date)}</td>
                <td className="py-2.5 pr-3">{l.description}</td>
                <td className="tabular py-2.5 pr-3 text-ink-soft">{l.sac}</td>
                <td className="tabular py-2.5 pr-3 text-right">{l.quantity}</td>
                <td className="tabular py-2.5 pr-3 text-right">{rupees(l.unitPrice)}</td>
                {taxed && <td className="tabular py-2.5 pr-3 text-right text-ink-soft">{l.gstRateBp > 0 ? pct(l.gstRateBp) : "—"}</td>}
                <td className="tabular py-2.5 text-right font-medium">{rupees(l.taxable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Tax summary on the left, totals on the right */}
      <section className="grid gap-6 border-t border-line py-5 sm:grid-cols-2">
        <div>
          {taxed && doc.taxSummary.length > 0 && (
            <table className="w-full text-sm">
              <caption className="mb-1.5 text-left text-xs font-semibold tracking-wider text-muted uppercase">Tax summary</caption>
              <thead>
                <tr className="border-b border-line-strong text-right text-xs text-muted">
                  <th className="py-1.5 pr-2 text-left font-semibold">Rate</th>
                  <th className="py-1.5 pr-2 font-semibold">Taxable</th>
                  <th className="py-1.5 pr-2 font-semibold">CGST</th>
                  <th className="py-1.5 font-semibold">SGST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {doc.taxSummary.map((t) => (
                  <tr key={t.rateBp} className="text-right">
                    <td className="py-1.5 pr-2 text-left">{pct(t.rateBp)}</td>
                    <td className="tabular py-1.5 pr-2">{rupees(t.taxable)}</td>
                    <td className="tabular py-1.5 pr-2">{rupees(t.cgst)}</td>
                    <td className="tabular py-1.5">{rupees(t.sgst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <dl className="space-y-1.5 text-sm">
          <Meta label={taxed ? "Taxable value" : "Subtotal"}>{rupees(doc.taxable)}</Meta>
          {taxed && <Meta label="CGST">{rupees(doc.cgst)}</Meta>}
          {taxed && <Meta label="SGST">{rupees(doc.sgst)}</Meta>}
          <div className="flex justify-between border-t border-line-strong pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular">{rupees(doc.total)}</dd>
          </div>
          <p className="pt-1 text-xs font-medium tracking-wide text-ink-soft">{doc.totalInWords}</p>
        </dl>
      </section>

      {/* Settlement: read live, so a payment recorded later shows here */}
      <section className="border-t border-line py-5 text-sm">
        <h2 className="mb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">Settlement</h2>
        {invoice.payments.length === 0 ? (
          <p className="text-muted">No payment received yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {invoice.payments.map((p, i) => (
              <li key={i} className="flex justify-between py-1.5">
                <span>
                  {p.amount < 0 ? "Refund" : "Received"} · {payModeLabel[p.mode]}
                  <span className="text-muted"> · {dayFmt(p.at)}</span>
                </span>
                <span className="tabular">{p.amount < 0 ? `−${rupees(-p.amount)}` : rupees(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className={clsx("mt-2 flex justify-between border-t border-line-strong pt-2 font-semibold", invoice.balance > 0 && "text-danger")}>
          <span>{invoice.balance > 0 ? "Balance due" : invoice.balance < 0 ? "Refund due" : "Paid in full"}</span>
          <span className="tabular">{rupees(Math.abs(invoice.balance))}</span>
        </div>
      </section>

      <footer className="border-t border-line pt-4 text-xs text-muted">
        {doc.footer && <p className="mb-3 whitespace-pre-line text-ink-soft">{doc.footer}</p>}
        <div className="flex items-end justify-between gap-6">
          <p>This is a computer-generated invoice.</p>
          <p className="border-t border-line-strong pt-1 text-ink-soft">Authorised signatory</p>
        </div>
      </footer>
    </article>
  );
}
