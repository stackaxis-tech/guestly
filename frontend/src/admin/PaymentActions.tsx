import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, ErrorNote, Field, Sheet, Textarea } from "../components/ui";
import { ApiError } from "../lib/api";
import { rupees } from "../lib/format";
import { adminApi, formatDate, useInvalidateAdmin, type Payment } from "./lib";

const linkClass = "text-xs font-semibold text-brand-700 hover:underline";

/** What staff can do with a recorded payment: open the receipt, send it, copy its link, or void it. */
export function PaymentActions({ payment: p }: { payment: Payment }) {
  const [voiding, setVoiding] = useState(false);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (copy === "idle") return;
    const t = setTimeout(() => setCopy("idle"), 2000);
    return () => clearTimeout(t);
  }, [copy]);

  const message = `Gustlog receipt ${p.receiptNo} for ${p.propertyName}: ${rupees(p.amount)} received. View or print it here: ${p.receiptUrl}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(p.receiptUrl);
      setCopy("done");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a className={linkClass} href={p.receiptUrl} target="_blank" rel="noreferrer">
          View receipt
        </a>
        {!p.voided && (
          <a className={linkClass} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
            Send on WhatsApp
          </a>
        )}
        <button type="button" className={linkClass} onClick={copyLink}>
          {copy === "done" ? "Link copied" : copy === "failed" ? "Couldn't copy" : "Copy link"}
        </button>
        {p.canVoid && (
          <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => setVoiding(true)}>
            Void payment
          </button>
        )}
      </div>
      {voiding && <VoidPaymentSheet payment={p} onClose={() => setVoiding(false)} />}
    </>
  );
}

function VoidPaymentSheet({ payment: p, onClose }: { payment: Payment; onClose: () => void }) {
  const invalidate = useInvalidateAdmin();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: () => adminApi(`/admin/payments/${p.id}/void`, { method: "POST", body: { reason: reason.trim() } }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields?.reason) setFieldError(err.fields.reason);
    },
  });

  function submit() {
    if (!reason.trim()) {
      setFieldError("Say why this payment is being voided.");
      return;
    }
    setFieldError(undefined);
    save.mutate();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Void receipt ${p.receiptNo}?`}
      description={`${p.propertyName} · ${rupees(p.amount)} paid on ${formatDate(p.paidOn)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep payment
          </Button>
          <Button variant="danger" loading={save.isPending} onClick={submit}>
            Void payment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
        <p className="text-sm text-ink-soft">
          The property's paid-until date goes back to what it was before this payment. The receipt number stays on record, marked void,
          and its link shows "Void". This can't be undone, so record the payment again if it was valid.
        </p>
        <Field label="Why is it being voided?" error={fieldError}>
          {(id, d) => (
            <Textarea
              id={id}
              aria-describedby={d}
              rows={3}
              maxLength={300}
              invalid={!!fieldError}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Sheet>
  );
}
