import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, ErrorNote, Field, Input, Select, Sheet, Spinner, Textarea } from "../components/ui";
import { ApiError } from "../lib/api";
import { rupees, toPaise } from "../lib/format";
import type { Property } from "../lib/property";
import {
  adminApi,
  planLabel,
  todayISO,
  useClient,
  useClients,
  useInvalidateAdmin,
  type ClientDetail,
} from "./lib";

/* ---------- Record payment ---------- */

const paymentSchema = z
  .object({
    amount: z.string().refine((s) => (toPaise(s) ?? 0) > 0, "Enter the amount received."),
    mode: z.enum(["upi", "bank", "cash", "other"]),
    reference: z.string().trim(),
    paidOn: z.string().min(1, "Enter the payment date."),
    months: z.coerce.number().int().min(1, "1 to 36 months.").max(36, "1 to 36 months."),
    notes: z.string(),
  })
  .refine((v) => !(v.mode === "upi" || v.mode === "bank") || v.reference.length > 0, {
    path: ["reference"],
    message: "Enter the UTR / transaction reference.",
  });

export function RecordPaymentSheet({ property, onClose }: { property: Property; onClose: () => void }) {
  const invalidate = useInvalidateAdmin();
  const s = property.subscription!;
  const form = useForm<z.input<typeof paymentSchema>>({
    resolver: zodResolver(paymentSchema),
    mode: "onTouched",
    defaultValues: { amount: String(s.amount / 100), mode: "upi", reference: "", paidOn: todayISO(), months: s.periodMonths, notes: "" },
  });
  const save = useMutation({
    mutationFn: (v: z.output<typeof paymentSchema>) =>
      adminApi(`/admin/properties/${property.id}/payments`, { method: "POST", body: { ...v, amount: toPaise(v.amount) } }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) for (const [k, m] of Object.entries(err.fields)) form.setError(k as never, { message: m });
    },
  });
  const e = form.formState.errors;
  const mode = form.watch("mode");

  return (
    <Sheet
      open
      onClose={onClose}
      title="Record payment"
      description={`${property.name} · ${planLabel(s.plan, s.periodMonths)} ${rupees(s.amount)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="pay-form" loading={save.isPending}>Record payment</Button>
        </>
      }
    >
      <form id="pay-form" noValidate className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v as z.output<typeof paymentSchema>))}>
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount received" error={e.amount?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" invalid={!!e.amount} {...form.register("amount")} />}
          </Field>
          <Field label="Paid on" error={e.paidOn?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" max={todayISO()} invalid={!!e.paidOn} {...form.register("paidOn")} />}
          </Field>
        </div>
        <Field label="Method">
          {(id, d) => (
            <Select id={id} aria-describedby={d} {...form.register("mode")}>
              <option value="upi">UPI</option>
              <option value="bank">Bank transfer (NEFT/IMPS/RTGS)</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
        <Field label="UTR / reference" optional={mode === "cash" || mode === "other"} error={e.reference?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} className="font-mono" invalid={!!e.reference} {...form.register("reference")} />}
        </Field>
        <Field label="Extends plan by (months)" error={e.months?.message} hint="The new period continues from the current end date.">
          {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" invalid={!!e.months} {...form.register("months")} />}
        </Field>
        <Field label="Notes" optional>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} {...form.register("notes")} />}
        </Field>
      </form>
    </Sheet>
  );
}

/**
 * The record-payment form for a property we only know by id, such as a row in the Renewals list.
 * It loads the client to get the plan the form needs.
 */
export function RecordPaymentFor({ clientId, propertyId, onClose }: { clientId: string; propertyId: string; onClose: () => void }) {
  const q = useClient(clientId);
  const property = q.data?.properties.find((p) => p.id === propertyId);
  if (property?.subscription) return <RecordPaymentSheet property={property} onClose={onClose} />;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Record payment"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />
      ) : (
        <ErrorNote message="This property has no plan yet. Open the client and set up its plan first." />
      )}
    </Sheet>
  );
}

/** Record a payment from the Payments page: pick the client and property first, then fill in the same form. */
export function RecordPaymentPicker({ onClose }: { onClose: () => void }) {
  const clients = useClients();
  const [clientId, setClientId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [chosen, setChosen] = useState<Property | null>(null);
  const client = useQuery({
    queryKey: ["admin", "client", clientId],
    queryFn: () => adminApi<ClientDetail>(`/admin/clients/${clientId}`),
    enabled: !!clientId,
  });

  if (chosen) return <RecordPaymentSheet property={chosen} onClose={onClose} />;

  const withPlan = (client.data?.properties ?? []).filter((p) => p.subscription);
  // A client with one property needs no second choice.
  const selectedId = propertyId || (withPlan.length === 1 ? withPlan[0].id : "");
  const selected = withPlan.find((p) => p.id === selectedId) ?? null;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Record payment"
      description="Choose who paid. You'll enter the amount and reference next."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!selected} onClick={() => selected && setChosen(selected)}>
            Continue
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {clients.error && <ErrorNote message={clients.error.message} onRetry={() => clients.refetch()} />}
        <Field label="Client">
          {(id, d) => (
            <Select
              id={id}
              aria-describedby={d}
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setPropertyId("");
              }}
            >
              <option value="">{clients.isLoading ? "Loading clients…" : "Choose a client"}</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {clientId && (
          <Field
            label="Property"
            error={client.error ? client.error.message : !client.isLoading && withPlan.length === 0 ? "This client has no property with a plan yet." : undefined}
          >
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={selectedId} onChange={(e) => setPropertyId(e.target.value)} disabled={client.isLoading}>
                {withPlan.length !== 1 && <option value="">{client.isLoading ? "Loading properties…" : "Choose a property"}</option>}
                {withPlan.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {planLabel(p.subscription!.plan, p.subscription!.periodMonths)} {rupees(p.subscription!.amount)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
    </Sheet>
  );
}
