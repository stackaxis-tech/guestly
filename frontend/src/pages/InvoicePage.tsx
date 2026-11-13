import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, MessageCircle, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { InvoiceDocument } from "../components/InvoiceDocument";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { WhatsAppSend } from "../components/WhatsAppSend";
import { api, ApiError, API_BASE } from "../lib/api";
import { isNative } from "../lib/platform";
import { useCurrentProperty } from "../lib/property";
import { useInvoice, useStay, type Invoice } from "../lib/stays";

/** The invoice for a stay, for staff: print it, copy the guest's link, or send it on WhatsApp. */
export function InvoicePage() {
  const { stayId = "" } = useParams();
  const property = useCurrentProperty();
  const qc = useQueryClient();
  const stay = useStay(property.id, stayId);
  const q = useInvoice(property.id, stayId);
  const [copy, setCopy] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [wa, setWa] = useState(false);
  const key = ["invoice", property.id, stayId];

  const create = useMutation({
    mutationFn: () => api<Invoice>(`/properties/${property.id}/stays/${stayId}/invoice`, { method: "POST" }),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      qc.invalidateQueries({ queryKey: ["stay", property.id, stayId] });
    },
  });
  const print = useMutation({
    mutationFn: () => api<Invoice>(`/properties/${property.id}/stays/${stayId}/invoice/print`, { method: "POST" }),
    onSuccess: (d) => {
      setCopy(d.copy); // label this print, then open the print dialog
      qc.setQueryData(key, { ...d, copy: "DUPLICATE" });
      setTimeout(() => window.print(), 100);
    },
  });
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const missing = q.error instanceof ApiError && q.error.status === 404;
  const back = (
    <Link to={`/stays/${stayId}`} className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> Back to stay
    </Link>
  );

  if (q.isLoading || stay.isLoading) return <Spinner />;

  if (missing) {
    const out = stay.data?.status === "checked_out";
    return (
      <>
        {back}
        <Card className="mx-auto max-w-md p-6 text-center">
          <h1 className="font-semibold">{out ? "No invoice yet" : "Invoice comes at checkout"}</h1>
          <p className="mt-1 text-sm text-muted">
            {out ? "This guest checked out before invoices were set up, or the invoice didn't save." : "The invoice is created when the guest checks out."}
          </p>
          {out && (
            <Button className="mt-4" loading={create.isPending} onClick={() => create.mutate()}>
              Create invoice
            </Button>
          )}
          {create.error && <div className="mt-3"><ErrorNote message={create.error.message} /></div>}
        </Card>
      </>
    );
  }
  if (q.error || !q.data) return <>{back}<ErrorNote message={q.error?.message ?? "Couldn't load the invoice."} onRetry={() => q.refetch()} /></>;
  const inv = q.data;

  return (
    <>
      {back}
      <div className="no-print mb-5 flex flex-wrap items-center gap-2">
        {!isNative && (
          <Button icon={<Printer className="size-4" />} loading={print.isPending} onClick={() => print.mutate()}>
            Print / Save as PDF
          </Button>
        )}
        <Button variant="secondary" icon={<MessageCircle className="size-4" />} onClick={() => setWa(true)}>
          Send on WhatsApp
        </Button>
        <Button
          variant="secondary"
          icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={() => navigator.clipboard.writeText(inv.shareUrl).then(() => setCopied(true))}
        >
          {copied ? "Link copied" : "Copy guest link"}
        </Button>
        {print.error && <ErrorNote message={print.error.message} />}
      </div>
      <InvoiceDocument invoice={inv} copy={copy} />
      <WhatsAppSend propertyId={property.id} stayId={stayId} kind="bill" open={wa} onClose={() => setWa(false)} />
    </>
  );
}

/** The guest's share link, /i/<token>. No login; the long random token is the key. */
export function PublicInvoicePage() {
  const { token = "" } = useParams();
  const q = useQuery({
    queryKey: ["public-invoice", token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/invoices/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error(res.status === 404 ? "This invoice link isn't valid." : "Couldn't load the invoice. Please try again.");
      return (await res.json()) as Invoice;
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

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10">
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !q.data ? (
        <ErrorNote message={q.error?.message ?? "Couldn't load the invoice."} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="no-print mb-5 flex justify-end">
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
              Print or save as PDF
            </Button>
          </div>
          <InvoiceDocument invoice={q.data} />
        </>
      )}
    </main>
  );
}
