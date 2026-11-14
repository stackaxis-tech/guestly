import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Logo } from "../components/brand/Logo";
import { Button, ErrorNote, Spinner } from "../components/ui";
import { API_BASE } from "../lib/api";
import { rupees } from "../lib/format";

type Receipt = {
  receiptNo: string;
  clientName: string;
  propertyName: string;
  amount: number;
  mode: "upi" | "bank" | "cash" | "other";
  reference: string;
  paidOn: string;
  periodFrom: string;
  periodTo: string;
  voided: boolean;
  voidedAt: string | null;
};

const modeLabel: Record<Receipt["mode"], string> = { upi: "UPI", bank: "Bank transfer", cash: "Cash", other: "Other" };

// Dates arrive as midnight UTC; read only the date part so no time zone can shift the day.
const day = (iso: string) =>
  new Date(iso.slice(0, 10) + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** A client's subscription receipt, opened from the link we send them. No sign-in; the link's token is the credential. */
export function PublicReceiptPage() {
  const { token = "" } = useParams();
  const q = useQuery({
    queryKey: ["public-receipt", token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/receipts/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error(res.status === 404 ? "This receipt link isn't valid." : "Couldn't load the receipt. Please try again.");
      return (await res.json()) as Receipt;
    },
    retry: false,
  });
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex";
    document.head.appendChild(m);
    return () => m.remove();
  }, []);

  const r = q.data;
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !r ? (
        <ErrorNote message={q.error?.message ?? "Couldn't load the receipt."} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="no-print mb-5 flex justify-end">
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
              Print or save as PDF
            </Button>
          </div>
          <article className="rounded-xl border border-line bg-paper p-6 sm:p-8">
            <header className="flex items-start justify-between gap-4 border-b border-line pb-5">
              <Logo size={30} />
              <div className="text-right">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">Payment receipt</p>
                <p className="font-mono text-sm font-semibold">{r.receiptNo}</p>
              </div>
            </header>

            {r.voided && (
              <p className="mt-5 rounded-lg border border-danger/20 bg-danger-bg px-4 py-3 text-sm font-semibold text-danger" role="alert">
                This receipt was voided{r.voidedAt ? ` on ${day(r.voidedAt)}` : ""} and is not valid.
              </p>
            )}

            <p className={r.voided ? "mt-5 text-muted line-through" : "mt-5"}>
              <span className="text-sm text-muted">Amount received</span>
              <span className="tabular block font-display text-4xl font-bold">{rupees(r.amount)}</span>
            </p>

            <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              <dt className="text-muted">Received from</dt>
              <dd className="font-medium">{r.clientName}</dd>
              <dt className="text-muted">Property</dt>
              <dd className="font-medium">{r.propertyName}</dd>
              <dt className="text-muted">Paid on</dt>
              <dd className="font-medium">{day(r.paidOn)}</dd>
              <dt className="text-muted">Method</dt>
              <dd className="font-medium">{modeLabel[r.mode]}</dd>
              {r.reference && (
                <>
                  <dt className="text-muted">Reference</dt>
                  <dd className="font-mono text-xs font-medium break-all">{r.reference}</dd>
                </>
              )}
              <dt className="text-muted">Plan covers</dt>
              <dd className="font-medium">
                {day(r.periodFrom)} to {day(r.periodTo)}
              </dd>
            </dl>

            <p className="mt-8 border-t border-line pt-4 text-xs text-muted">
              Subscription payment received by Gustlog. This is a receipt, not a GST tax invoice.
            </p>
          </article>
        </>
      )}
    </main>
  );
}
