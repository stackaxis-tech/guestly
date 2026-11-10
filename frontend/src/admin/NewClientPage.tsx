import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Check, Copy, MessageCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { LogoPicker } from "../components/PropertyLogo";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Textarea } from "../components/ui";
import { ApiError } from "../lib/api";
import { rupees, toPaise } from "../lib/format";
import { adminApi, todayISO, useInvalidateAdmin, whatsappInviteLink } from "./lib";

/* ---------- Shared plan + payment fields (also used by "Add property") ---------- */

export const PLAN_PRICES = { annual: 89900, monthly: 9000 } as const;

const rupeeString = (msg: string) => z.string().refine((s) => (toPaise(s) ?? -1) >= 0, msg);

export const planSchema = z
  .object({
    plan: z.enum(["annual", "monthly", "custom"]),
    amount: rupeeString("Enter the price, like 899."),
    periodMonths: z.coerce.number().int().min(1, "1 to 36 months.").max(36, "1 to 36 months."),
    trialDays: z.coerce.number().int().min(0, "0 to 90 days.").max(90, "0 to 90 days."),
    paid: z.boolean(),
    payAmount: z.string(),
    payMode: z.enum(["upi", "bank", "cash", "other"]),
    payReference: z.string().trim(),
    payDate: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.paid && v.trialDays === 0) {
      ctx.addIssue({ code: "custom", path: ["trialDays"], message: "Give a free trial, or record the first payment." });
    }
    if (v.paid) {
      if ((toPaise(v.payAmount) ?? 0) <= 0) ctx.addIssue({ code: "custom", path: ["payAmount"], message: "Enter the amount received." });
      if ((v.payMode === "upi" || v.payMode === "bank") && !v.payReference)
        ctx.addIssue({ code: "custom", path: ["payReference"], message: "Enter the UTR / transaction reference." });
      if (!v.payDate) ctx.addIssue({ code: "custom", path: ["payDate"], message: "Enter the payment date." });
    }
  });

export type PlanValues = z.input<typeof planSchema>;

export const planDefaults: PlanValues = {
  plan: "annual",
  amount: "899",
  periodMonths: 12,
  trialDays: 14,
  paid: false,
  payAmount: "899",
  payMode: "upi",
  payReference: "",
  payDate: todayISO(),
};

export function toPlanPayload(v: z.output<typeof planSchema>) {
  return {
    plan: v.plan,
    amount: toPaise(v.amount)!,
    periodMonths: v.plan === "custom" ? v.periodMonths : v.plan === "annual" ? 12 : 1,
    trialDays: v.trialDays,
    firstPayment: v.paid
      ? { amount: toPaise(v.payAmount)!, mode: v.payMode, reference: v.payReference, paidOn: v.payDate, months: 0, notes: "" }
      : null,
  };
}

/** Maps nested API errors like "plan.firstPayment.reference" to our flat plan fields. */
export function planFieldFromApi(key: string): string | null {
  const map: Record<string, string> = {
    "plan.plan": "plan",
    "plan.amount": "amount",
    "plan.periodMonths": "periodMonths",
    "plan.trialDays": "trialDays",
    "plan.firstPayment.amount": "payAmount",
    "plan.firstPayment.mode": "payMode",
    "plan.firstPayment.reference": "payReference",
    "plan.firstPayment.paidOn": "payDate",
    reference: "payReference",
  };
  return map[key] ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function PlanFields({ form, prefix = "" }: { form: UseFormReturn<any>; prefix?: string }) {
  const n = (k: string) => (prefix ? `${prefix}.${k}` : k);
  const get = (k: string) => form.watch(n(k));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = (k: string): string | undefined => (prefix ? (form.formState.errors as any)[prefix]?.[k] : (form.formState.errors as any)[k])?.message;
  const plan = get("plan") as PlanValues["plan"];
  const paid = get("paid") as boolean;

  const choose = (p: PlanValues["plan"]) => {
    form.setValue(n("plan"), p, { shouldDirty: true });
    if (p !== "custom") {
      const price = String(PLAN_PRICES[p] / 100);
      form.setValue(n("amount"), price);
      form.setValue(n("payAmount"), price);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Plan">
        {(
          [
            ["annual", "Annual", `${rupees(PLAN_PRICES.annual)} / year`],
            ["monthly", "Monthly", `${rupees(PLAN_PRICES.monthly)} / month`],
            ["custom", "Custom", "Your own price & period"],
          ] as const
        ).map(([key, title, sub]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={plan === key}
            onClick={() => choose(key)}
            className={clsx(
              "rounded-xl border-2 px-4 py-3 text-left transition-colors",
              plan === key ? "border-brand-700 bg-brand-50" : "border-line hover:border-line-strong",
            )}
          >
            <span className="flex items-center justify-between">
              <span className="font-semibold">{title}</span>
              {plan === key && <Check className="size-4 text-brand-700" aria-hidden />}
            </span>
            <span className="text-sm text-muted">{sub}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Price per property" error={err("amount")} hint={plan === "custom" ? undefined : "Change it for a special deal."}>
          {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" invalid={!!err("amount")} {...form.register(n("amount"))} />}
        </Field>
        {plan === "custom" && (
          <Field label="Billing period (months)" error={err("periodMonths")}>
            {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" invalid={!!err("periodMonths")} {...form.register(n("periodMonths"))} />}
          </Field>
        )}
        <Field label="Free trial (days)" error={err("trialDays")} hint="0 means no trial.">
          {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" invalid={!!err("trialDays")} {...form.register(n("trialDays"))} />}
        </Field>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-4 py-3 hover:bg-sand/50">
        <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" {...form.register(n("paid"))} />
        <span>
          <span className="block text-sm font-semibold">Payment already received</span>
          <span className="block text-sm text-muted">Record it now and issue the receipt. The paid period starts after any trial.</span>
        </span>
      </label>

      {paid && (
        <div className="grid gap-4 rounded-lg bg-sand/60 p-4 sm:grid-cols-2">
          <Field label="Amount received" error={err("payAmount")}>
            {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" invalid={!!err("payAmount")} {...form.register(n("payAmount"))} />}
          </Field>
          <Field label="Paid on" error={err("payDate")}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" max={todayISO()} invalid={!!err("payDate")} {...form.register(n("payDate"))} />}
          </Field>
          <Field label="Method" error={err("payMode")}>
            {(id, d) => (
              <Select id={id} aria-describedby={d} {...form.register(n("payMode"))}>
                <option value="upi">UPI</option>
                <option value="bank">Bank transfer (NEFT/IMPS/RTGS)</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </Select>
            )}
          </Field>
          <Field label="UTR / reference" error={err("payReference")} optional={get("payMode") === "cash" || get("payMode") === "other"}>
            {(id, d) => <Input id={id} aria-describedby={d} className="font-mono" invalid={!!err("payReference")} {...form.register(n("payReference"))} />}
          </Field>
        </div>
      )}
    </div>
  );
}

/* ---------- Invite link card ---------- */

export function InviteCard({ url, name, phone }: { url: string; name: string; phone?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-accent-200 bg-accent-50 p-4">
      <p className="text-sm font-semibold text-accent-700">Invite link for {name}</p>
      <p className="mt-0.5 text-sm text-ink-soft">They open it to set their password. It works once and expires in 7 days.</p>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        {phone && (
          <a href={whatsappInviteLink(phone, name, url)} target="_blank" rel="noreferrer">
            <Button size="sm" icon={<MessageCircle className="size-4" />}>
              Send on WhatsApp
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

/* ---------- New client page ---------- */

const optionalEmail = z.union([z.literal(""), z.string().trim().email("Enter a valid email address.")]);
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/, "GSTIN should be 15 characters, like 29ABCDE1234F1Z5.");

const schema = z.object({
  client: z.object({
    name: z.string().trim().min(1, "Enter the client's business name."),
    contactName: z.string().trim(),
    contactPhone: z.string().trim().min(1, "Enter a contact phone number."),
    contactEmail: optionalEmail,
    billingGstin: gstin,
    notes: z.string(),
  }),
  property: z.object({
    name: z.string().trim().min(1, "Enter the hotel name."),
    address: z.string(),
    city: z.string().trim(),
    state: z.string().trim(),
    pincode: z.string().trim().regex(/^([1-9][0-9]{5})?$/, "PIN code should be 6 digits."),
    phone: z.string().trim(),
    gstin,
    invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, "Up to 10 letters, numbers, or dashes."),
  }),
  owner: z.object({
    name: z.string().trim().min(1, "Enter the owner's name."),
    email: z.string().trim().email("Enter a valid email. The owner signs in with it."),
    phone: z.string().trim(),
  }),
  plan: planSchema,
});
type Values = z.input<typeof schema>;

function Section({ step, title, body, children }: { step: number; title: string; body: string; children: ReactNode }) {
  return (
    <Card>
      <div className="flex gap-3 border-b border-line px-5 py-4">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-ivory">{step}</span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted">{body}</p>
        </div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </Card>
  );
}

type Created = { clientId: string; inviteUrl: string; ownerName: string; ownerPhone: string; logoError?: string };

export function NewClientPage() {
  const invalidate = useInvalidateAdmin();
  const navigate = useNavigate();
  const [logo, setLogo] = useState<File | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: {
      client: { name: "", contactName: "", contactPhone: "", contactEmail: "", billingGstin: "", notes: "" },
      property: { name: "", address: "", city: "", state: "", pincode: "", phone: "", gstin: "", invoicePrefix: "INV" },
      owner: { name: "", email: "", phone: "" },
      plan: planDefaults,
    },
  });

  const create = useMutation({
    mutationFn: async (v: z.output<typeof schema>) => {
      const res = await adminApi<{ clientId: string; propertyId: string; inviteUrl: string }>("/admin/clients", {
        method: "POST",
        body: {
          client: v.client,
          property: { ...v.property, email: "", googleReviewUrl: "", checkInTime: "", checkOutTime: "" },
          owner: v.owner,
          plan: toPlanPayload(v.plan),
        },
      });
      let logoError: string | undefined;
      if (logo) {
        const fd = new FormData();
        fd.append("logo", logo);
        try {
          await adminApi(`/admin/properties/${res.propertyId}/logo`, { method: "POST", form: fd });
        } catch (e) {
          logoError = e instanceof Error ? e.message : "Logo upload failed.";
        }
      }
      return { ...res, logoError, ownerName: v.owner.name, ownerPhone: v.owner.phone || v.client.contactPhone };
    },
    onSuccess: (r) => {
      invalidate();
      setCreated(r);
      window.scrollTo({ top: 0 });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [k, msg] of Object.entries(err.fields)) {
          const planKey = planFieldFromApi(k);
          form.setError((planKey ? `plan.${planKey}` : k) as never, { message: msg });
        }
      }
    },
  });

  if (created) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex size-12 items-center justify-center rounded-full bg-ready-bg text-ready">
          <Check className="size-6" aria-hidden />
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">{form.getValues("client.name")} is on Guestlog</h1>
        <p className="mt-2 text-muted">Send the owner their invite so they can set a password and sign in.</p>
        {created.logoError && <div className="mt-4"><ErrorNote message={`Client created, but the logo didn't upload: ${created.logoError} You can add it from the client page.`} /></div>}
        <div className="mt-6">
          <InviteCard url={created.inviteUrl} name={created.ownerName} phone={created.ownerPhone} />
        </div>
        <div className="mt-6 flex gap-2">
          <Button onClick={() => navigate(`/admin/clients/${created.clientId}`)}>Open client</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setCreated(null);
              setLogo(null);
              form.reset();
            }}
          >
            Create another
          </Button>
        </div>
      </div>
    );
  }

  const e = form.formState.errors;
  const reg = form.register;
  const propName = form.watch("property.name");
  const showGeneralError = create.error && !(create.error instanceof ApiError && create.error.fields);

  return (
    <>
      <Link to="/admin/clients" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Clients
      </Link>
      <PageHeader eyebrow="Guestlog console" title="New client" description="Set up the business, their first hotel, the owner's login, and their plan." />
      <form noValidate onSubmit={form.handleSubmit((v) => create.mutate(v as z.output<typeof schema>))} className="flex flex-col gap-5">
        <Section step={1} title="Business" body="Who Guestlog bills. Shown on their payment receipts.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" error={e.client?.name?.message} className="sm:col-span-2">
              {(id, d) => <Input id={id} aria-describedby={d} placeholder="Lakeview Stays Pvt Ltd" invalid={!!e.client?.name} {...reg("client.name")} />}
            </Field>
            <Field label="Contact person" optional>
              {(id, d) => <Input id={id} aria-describedby={d} {...reg("client.contactName")} />}
            </Field>
            <Field label="Contact phone" error={e.client?.contactPhone?.message}>
              {(id, d) => <Input id={id} aria-describedby={d} type="tel" placeholder="+91 98xxx xxxxx" invalid={!!e.client?.contactPhone} {...reg("client.contactPhone")} />}
            </Field>
            <Field label="Billing email" optional error={e.client?.contactEmail?.message}>
              {(id, d) => <Input id={id} aria-describedby={d} type="email" invalid={!!e.client?.contactEmail} {...reg("client.contactEmail")} />}
            </Field>
            <Field label="Billing GSTIN" optional error={e.client?.billingGstin?.message}>
              {(id, d) => <Input id={id} aria-describedby={d} invalid={!!e.client?.billingGstin} {...reg("client.billingGstin")} />}
            </Field>
            <Field label="Internal notes" optional className="sm:col-span-2" hint="Only visible to Guestlog admins.">
              {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} {...reg("client.notes")} />}
            </Field>
          </div>
        </Section>

        <Section step={2} title="First hotel" body="Its logo appears in their app, on GST invoices, and on the guest review page.">
          <div className="flex flex-col gap-5">
            <LogoPicker name={propName} file={logo} onChange={setLogo} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hotel name" error={e.property?.name?.message} className="sm:col-span-2">
                {(id, d) => <Input id={id} aria-describedby={d} placeholder="Lakeview Homestay" invalid={!!e.property?.name} {...reg("property.name")} />}
              </Field>
              <Field label="Address" optional className="sm:col-span-2">
                {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} {...reg("property.address")} />}
              </Field>
              <Field label="City" optional>
                {(id, d) => <Input id={id} aria-describedby={d} {...reg("property.city")} />}
              </Field>
              <Field label="State" optional hint="Decides CGST+SGST or IGST on their invoices.">
                {(id, d) => <Input id={id} aria-describedby={d} {...reg("property.state")} />}
              </Field>
              <Field label="PIN code" optional error={e.property?.pincode?.message}>
                {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" invalid={!!e.property?.pincode} {...reg("property.pincode")} />}
              </Field>
              <Field label="Front desk phone" optional>
                {(id, d) => <Input id={id} aria-describedby={d} type="tel" {...reg("property.phone")} />}
              </Field>
              <Field label="Hotel GSTIN" optional error={e.property?.gstin?.message}>
                {(id, d) => <Input id={id} aria-describedby={d} invalid={!!e.property?.gstin} {...reg("property.gstin")} />}
              </Field>
              <Field label="Invoice prefix" error={e.property?.invoicePrefix?.message} hint="Their guest invoices: PREFIX/2026-27/0001">
                {(id, d) => <Input id={id} aria-describedby={d} invalid={!!e.property?.invoicePrefix} {...reg("property.invoicePrefix")} />}
              </Field>
            </div>
          </div>
        </Section>

        <Section step={3} title="Owner login" body="We'll create their account and give you an invite link. You never see their password.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner name" error={e.owner?.name?.message}>
              {(id, d) => <Input id={id} aria-describedby={d} invalid={!!e.owner?.name} {...reg("owner.name")} />}
            </Field>
            <Field label="Owner email" error={e.owner?.email?.message} hint="They sign in with this.">
              {(id, d) => <Input id={id} aria-describedby={d} type="email" invalid={!!e.owner?.email} {...reg("owner.email")} />}
            </Field>
            <Field label="Owner WhatsApp number" optional hint="To send the invite on WhatsApp.">
              {(id, d) => <Input id={id} aria-describedby={d} type="tel" {...reg("owner.phone")} />}
            </Field>
          </div>
        </Section>

        <Section step={4} title="Plan" body="Billed per property. You can change the plan or record payments later.">
          <PlanFields form={form} prefix="plan" />
        </Section>

        {showGeneralError && <ErrorNote message={create.error!.message} />}
        {Object.keys(e).length > 0 && <p className="text-sm text-danger" role="alert">Some fields above need attention.</p>}
        <div className="flex justify-end gap-2 pb-4">
          <Link to="/admin/clients">
            <Button type="button" variant="secondary">Cancel</Button>
          </Link>
          <Button type="submit" loading={create.isPending}>
            Create client
          </Button>
        </div>
      </form>
    </>
  );
}
