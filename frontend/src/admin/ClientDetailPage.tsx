import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, CalendarClock, Mail, Pencil, Phone, Plus, Receipt, Send, ShieldOff, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";
import { LogoPicker, PropertyLogo } from "../components/PropertyLogo";
import { Button, Card, ErrorNote, Field, Input, Select, Sheet, Spinner, Textarea } from "../components/ui";
import { ApiError } from "../lib/api";
import { rupees, toPaise } from "../lib/format";
import type { Property } from "../lib/property";
import { StateBadge, PaymentsTable } from "./AdminPages";
import {
  adminApi,
  billingStateMeta,
  formatDate,
  planLabel,
  relativeDays,
  useClient,
  useInvalidateAdmin,
  type ClientDetail,
  type ClientUser,
} from "./lib";
import { RecordPaymentSheet } from "./RecordPayment";
import { InviteCard, PlanFields, planDefaults, planFieldFromApi, planSchema, toPlanPayload } from "./NewClientPage";

type Tab = "properties" | "users" | "payments" | "details";

export function ClientDetailPage() {
  const { clientId = "" } = useParams();
  const q = useClient(clientId);
  const [tab, setTab] = useState<Tab>("properties");
  const [sheet, setSheet] = useState<
    | { kind: "payment" | "plan" | "editProperty"; property: Property }
    | { kind: "addProperty" | "editClient" | "status" }
    | null
  >(null);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const close = () => setSheet(null);
  const suspended = c.status === "suspended";

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "properties", label: "Properties", count: c.properties.length },
    { key: "users", label: "Users", count: c.users.length },
    { key: "payments", label: "Payments", count: c.payments.length },
    { key: "details", label: "Details" },
  ];

  return (
    <>
      <Link to="/admin/clients" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Clients
      </Link>

      <header className="mb-6 flex flex-wrap items-start gap-4">
        <PropertyLogo name={c.name} url={c.properties[0]?.logoUrl} size={56} className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[28px] leading-tight font-bold tracking-tight">{c.name}</h1>
            <StateBadge state={c.state} />
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {c.contactName && <span>{c.contactName}</span>}
            {c.contactPhone && (
              <a href={`tel:${c.contactPhone}`} className="inline-flex items-center gap-1 hover:text-ink">
                <Phone className="size-3.5" aria-hidden /> {c.contactPhone}
              </a>
            )}
            {c.contactEmail && (
              <a href={`mailto:${c.contactEmail}`} className="inline-flex items-center gap-1 hover:text-ink">
                <Mail className="size-3.5" aria-hidden /> {c.contactEmail}
              </a>
            )}
            <span>Client since {formatDate(c.createdAt)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={suspended ? <ShieldCheck className="size-4" /> : <ShieldOff className="size-4" />}
            onClick={() => setSheet({ kind: "status" })}
          >
            {suspended ? "Reactivate" : "Suspend"}
          </Button>
        </div>
      </header>

      {suspended && (
        <div className="mb-5 rounded-xl border border-line-strong bg-maintenance-bg px-4 py-3 text-sm text-maintenance">
          This client is suspended. Their staff are signed out and can't sign in until you reactivate them.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">Total paid</p>
          <p className="tabular font-display text-2xl font-bold">{rupees(c.totalPaid)}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-muted">Properties</p>
          <p className="tabular font-display text-2xl font-bold">{c.properties.length}</p>
        </Card>
        <Card className="col-span-2 px-4 py-3 sm:col-span-1">
          <p className="text-xs text-muted">Last payment</p>
          <p className="font-display text-2xl font-bold">{formatDate(c.payments.find((x) => !x.voided)?.paidOn)}</p>
        </Card>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
              tab === t.key ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-muted">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === "properties" && (
        <div className="flex flex-col gap-4">
          {c.properties.map((p) => (
            <PropertyCard key={p.id} p={p} onAction={(kind) => setSheet({ kind, property: p })} />
          ))}
          <button
            onClick={() => setSheet({ kind: "addProperty" })}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong py-5 text-sm font-semibold text-brand-700 hover:border-brand-400 hover:bg-brand-50"
          >
            <Plus className="size-4" aria-hidden /> Add another property
          </button>
        </div>
      )}
      {tab === "users" && <UsersList client={c} />}
      {tab === "payments" && (
        <Card className="overflow-hidden">
          {c.payments.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">No payments recorded for this client yet.</p>
          ) : (
            <PaymentsTable payments={c.payments} showClient={false} />
          )}
        </Card>
      )}
      {tab === "details" && <ClientDetails client={c} onEdit={() => setSheet({ kind: "editClient" })} />}

      {sheet?.kind === "payment" && <RecordPaymentSheet property={sheet.property} onClose={close} />}
      {sheet?.kind === "plan" && <EditPlanSheet property={sheet.property} onClose={close} />}
      {sheet?.kind === "editProperty" && <EditPropertySheet property={sheet.property} onClose={close} />}
      {sheet?.kind === "addProperty" && <AddPropertySheet clientId={c.id} onClose={close} />}
      {sheet?.kind === "editClient" && <EditClientSheet client={c} onClose={close} />}
      {sheet?.kind === "status" && <StatusSheet client={c} onClose={close} />}
    </>
  );
}

/* ---------- Property card ---------- */

function PropertyCard({ p, onAction }: { p: Property; onAction: (k: "payment" | "plan" | "editProperty") => void }) {
  const s = p.subscription;
  const b = p.billing;
  const meta = b ? billingStateMeta[b.state] : null;
  const place = [p.city, p.state].filter(Boolean).join(", ");

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4 px-5 py-4">
        <PropertyLogo name={p.name} url={p.logoUrl} size={48} className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{p.name}</p>
          <p className="text-sm text-muted">{place || "No address yet"}{p.gstin && ` · GSTIN ${p.gstin}`}</p>
        </div>
        <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => onAction("editProperty")}>
          Edit & logo
        </Button>
      </div>
      {s && b && meta ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line bg-sand/40 px-5 py-3.5">
          <div>
            <p className="text-xs text-muted">Plan</p>
            <p className="text-sm font-semibold">
              {planLabel(s.plan, s.periodMonths)} · <span className="tabular">{rupees(s.amount)}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">{b.state === "trial" ? "Trial ends" : b.daysLeft < 0 ? "Ended" : "Paid until"}</p>
            <p className="text-sm font-semibold">
              {formatDate(s.endsOn)} <span className="font-normal text-muted">({relativeDays(b.daysLeft)})</span>
            </p>
          </div>
          <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.className)}>
            {meta.label}
            {b.state === "grace" && ` · read-only in ${b.graceDaysLeft} ${b.graceDaysLeft === 1 ? "day" : "days"}`}
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => onAction("plan")}>
              Change plan
            </Button>
            <Button size="sm" icon={<Receipt className="size-4" />} onClick={() => onAction("payment")}>
              Record payment
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-line px-5 py-3 text-sm text-danger">No plan set up for this property.</p>
      )}
    </Card>
  );
}

/* ---------- Edit plan ---------- */

const editPlanSchema = z.object({
  plan: z.enum(["annual", "monthly", "custom"]),
  amount: z.string().refine((s) => (toPaise(s) ?? -1) >= 0, "Enter the price."),
  periodMonths: z.coerce.number().int().min(1).max(36),
  graceDays: z.coerce.number().int().min(0, "0 to 60 days.").max(60, "0 to 60 days."),
  endsOn: z.string().min(1, "Enter the end date."),
  reason: z.string().trim(),
});

function EditPlanSheet({ property, onClose }: { property: Property; onClose: () => void }) {
  const invalidate = useInvalidateAdmin();
  const s = property.subscription!;
  const form = useForm<z.input<typeof editPlanSchema>>({
    resolver: zodResolver(editPlanSchema),
    mode: "onTouched",
    defaultValues: {
      plan: s.plan,
      amount: String(s.amount / 100),
      periodMonths: s.periodMonths,
      graceDays: s.graceDays,
      endsOn: s.endsOn.slice(0, 10),
      reason: "",
    },
  });
  const save = useMutation({
    mutationFn: (v: z.output<typeof editPlanSchema>) =>
      adminApi(`/admin/properties/${property.id}/subscription`, { method: "PUT", body: { ...v, amount: toPaise(v.amount) } }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) for (const [k, m] of Object.entries(err.fields)) form.setError(k as never, { message: m });
    },
  });
  const e = form.formState.errors;
  const plan = form.watch("plan");

  return (
    <Sheet
      open
      onClose={onClose}
      title="Change plan"
      description={property.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="plan-form" loading={save.isPending}>Save plan</Button>
        </>
      }
    >
      <form id="plan-form" noValidate className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v as z.output<typeof editPlanSchema>))}>
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan">
            {(id, d) => (
              <Select id={id} aria-describedby={d} {...form.register("plan")}>
                <option value="annual">Annual</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom</option>
              </Select>
            )}
          </Field>
          <Field label="Price" error={e.amount?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" invalid={!!e.amount} {...form.register("amount")} />}
          </Field>
        </div>
        {plan === "custom" && (
          <Field label="Billing period (months)" error={e.periodMonths?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="number" {...form.register("periodMonths")} />}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid until" error={e.endsOn?.message} hint="Correct mistakes or give extra days.">
            {(id, d) => <Input id={id} aria-describedby={d} type="date" invalid={!!e.endsOn} {...form.register("endsOn")} />}
          </Field>
          <Field label="Grace period (days)" error={e.graceDays?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="number" invalid={!!e.graceDays} {...form.register("graceDays")} />}
          </Field>
        </div>
        <Field label="Reason" optional hint="Saved in the activity log.">
          {(id, d) => <Input id={id} aria-describedby={d} placeholder="e.g. Diwali offer, 1 month free" {...form.register("reason")} />}
        </Field>
      </form>
    </Sheet>
  );
}

/* ---------- Edit property + logo ---------- */

const propertySchema = z.object({
  name: z.string().trim().min(1, "Enter the hotel name."),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  pincode: z.string().trim().regex(/^([1-9][0-9]{5})?$/, "PIN code should be 6 digits."),
  phone: z.string(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email.")]),
  gstin: z.string().trim().toUpperCase().regex(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/, "GSTIN should be 15 characters."),
  googleReviewUrl: z.union([z.literal(""), z.string().trim().url("Paste the full https:// link.")]),
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, "Up to 10 letters, numbers, or dashes."),
  checkInTime: z.string(),
  checkOutTime: z.string(),
});

function EditPropertySheet({ property, onClose }: { property: Property; onClose: () => void }) {
  const invalidate = useInvalidateAdmin();
  const [logo, setLogo] = useState<File | null>(null);
  const [logoError, setLogoError] = useState("");
  const form = useForm<z.input<typeof propertySchema>>({ resolver: zodResolver(propertySchema), mode: "onTouched", defaultValues: property });

  const save = useMutation({
    mutationFn: async (v: z.output<typeof propertySchema>) => {
      await adminApi(`/admin/properties/${property.id}`, { method: "PUT", body: v });
      if (logo) {
        const fd = new FormData();
        fd.append("logo", logo);
        await adminApi(`/admin/properties/${property.id}/logo`, { method: "POST", form: fd });
      }
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [k, m] of Object.entries(err.fields)) {
          if (k === "logo") setLogoError(m);
          else form.setError(k as never, { message: m });
        }
      }
    },
  });
  const removeLogo = useMutation({
    mutationFn: () => adminApi(`/admin/properties/${property.id}/logo`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });

  const e = form.formState.errors;
  const text = (name: keyof z.input<typeof propertySchema>, label: string, optional = true, type?: string) => (
    <Field label={label} optional={optional} error={e[name]?.message}>
      {(id, d) => <Input id={id} aria-describedby={d} type={type} invalid={!!e[name]} {...form.register(name)} />}
    </Field>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Edit ${property.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="prop-form" loading={save.isPending}>Save</Button>
        </>
      }
    >
      <form id="prop-form" noValidate className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v as z.output<typeof propertySchema>))}>
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
        <LogoPicker
          name={form.watch("name")}
          currentUrl={removeLogo.isSuccess ? undefined : property.logoUrl || undefined}
          file={logo}
          onChange={(f) => {
            setLogo(f);
            setLogoError("");
          }}
          onRemove={() => removeLogo.mutate()}
          error={logoError}
          busy={removeLogo.isPending}
        />
        {text("name", "Hotel name", false)}
        <Field label="Address" optional>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} {...form.register("address")} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {text("city", "City")}
          {text("state", "State")}
          {text("pincode", "PIN code")}
          {text("phone", "Phone", true, "tel")}
        </div>
        {text("email", "Email", true, "email")}
        <div className="grid grid-cols-2 gap-3">
          {text("gstin", "GSTIN")}
          {text("invoicePrefix", "Invoice prefix", false)}
        </div>
        {text("googleReviewUrl", "Google review link")}
      </form>
    </Sheet>
  );
}

/* ---------- Add property ---------- */

const addSchema = z.object({
  name: z.string().trim().min(1, "Enter the hotel name."),
  city: z.string().trim(),
  state: z.string().trim(),
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, "Up to 10 letters, numbers, or dashes."),
  plan: planSchema,
});

function AddPropertySheet({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const invalidate = useInvalidateAdmin();
  const [logo, setLogo] = useState<File | null>(null);
  const form = useForm<z.input<typeof addSchema>>({
    resolver: zodResolver(addSchema),
    mode: "onTouched",
    defaultValues: { name: "", city: "", state: "", invoicePrefix: "INV", plan: planDefaults },
  });
  const save = useMutation({
    mutationFn: async (v: z.output<typeof addSchema>) => {
      const res = await adminApi<{ propertyId: string }>(`/admin/clients/${clientId}/properties`, {
        method: "POST",
        body: {
          property: { name: v.name, city: v.city, state: v.state, invoicePrefix: v.invoicePrefix, address: "", pincode: "", phone: "", email: "", gstin: "", googleReviewUrl: "", checkInTime: "", checkOutTime: "" },
          plan: toPlanPayload(v.plan),
        },
      });
      if (logo) {
        const fd = new FormData();
        fd.append("logo", logo);
        await adminApi(`/admin/properties/${res.propertyId}/logo`, { method: "POST", form: fd }).catch(() => {});
      }
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [k, m] of Object.entries(err.fields)) {
          const pk = planFieldFromApi(k);
          form.setError((pk ? `plan.${pk}` : k.replace(/^property\./, "")) as never, { message: m });
        }
      }
    },
  });
  const e = form.formState.errors;

  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a property"
      description="Each property has its own logo, rooms, invoices, and plan."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-prop-form" loading={save.isPending}>Add property</Button>
        </>
      }
    >
      <form id="add-prop-form" noValidate className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v as z.output<typeof addSchema>))}>
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
        <LogoPicker name={form.watch("name")} file={logo} onChange={setLogo} />
        <Field label="Hotel name" error={e.name?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} invalid={!!e.name} {...form.register("name")} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" optional>{(id, d) => <Input id={id} aria-describedby={d} {...form.register("city")} />}</Field>
          <Field label="State" optional>{(id, d) => <Input id={id} aria-describedby={d} {...form.register("state")} />}</Field>
        </div>
        <Field label="Invoice prefix" error={e.invoicePrefix?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} invalid={!!e.invoicePrefix} {...form.register("invoicePrefix")} />}
        </Field>
        <div className="border-t border-line pt-4">
          <p className="mb-3 text-sm font-semibold">Plan for this property</p>
          <PlanFields form={form} prefix="plan" />
        </div>
      </form>
    </Sheet>
  );
}

/* ---------- Users ---------- */

const roleName: Record<string, string> = { owner: "Owner", manager: "Manager", front_desk: "Front desk", housekeeping: "Housekeeping" };

function UsersList({ client }: { client: ClientDetail }) {
  const [invite, setInvite] = useState<{ user: ClientUser; url: string } | null>(null);
  const invalidate = useInvalidateAdmin();
  const resend = useMutation({
    mutationFn: (u: ClientUser) =>
      adminApi<{ inviteUrl: string }>(`/admin/clients/${client.id}/users/${u.id}/invite`, { method: "POST" }).then((r) => ({ user: u, url: r.inviteUrl })),
    onSuccess: (r) => {
      setInvite(r);
      invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      {invite && <InviteCard url={invite.url} name={invite.user.name} phone={invite.user.phone ?? client.contactPhone} />}
      {resend.error && <ErrorNote message={resend.error.message} />}
      <Card>
        <ul className="divide-y divide-line">
          {client.users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{u.name}</span>
                <span className="block text-sm text-muted">
                  {roleName[u.role] ?? u.role} · {u.email}
                </span>
              </span>
              {u.activated ? (
                <span className="rounded-full bg-ready-bg px-2.5 py-0.5 text-xs font-semibold text-ready">Active</span>
              ) : (
                <>
                  <span className="rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-700">Invite pending</span>
                  <Button size="sm" variant="secondary" icon={<Send className="size-4" />} loading={resend.isPending && resend.variables?.id === u.id} onClick={() => resend.mutate(u)}>
                    New invite link
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-sm text-muted">The owner can add their own staff from their Gustlog settings (coming with check-in).</p>
    </div>
  );
}

/* ---------- Details & edit ---------- */

function ClientDetails({ client: c, onEdit }: { client: ClientDetail; onEdit: () => void }) {
  const rows: [string, string][] = [
    ["Business name", c.name],
    ["Contact person", c.contactName || "—"],
    ["Contact phone", c.contactPhone || "—"],
    ["Billing email", c.contactEmail || "—"],
    ["Billing GSTIN", c.billingGstin || "—"],
    ["Internal notes", c.notes || "—"],
  ];
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-semibold">Business details</h2>
        <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={onEdit}>Edit</Button>
      </div>
      <dl className="divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[180px_1fr]">
            <dt className="text-sm text-muted">{k}</dt>
            <dd className="text-sm whitespace-pre-wrap">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const clientSchema = z.object({
  name: z.string().trim().min(1, "Enter the business name."),
  contactName: z.string(),
  contactPhone: z.string().trim().min(1, "Enter a contact phone number."),
  contactEmail: z.union([z.literal(""), z.string().trim().email("Enter a valid email.")]),
  billingGstin: z.string().trim().toUpperCase().regex(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/, "GSTIN should be 15 characters."),
  notes: z.string(),
});

function EditClientSheet({ client, onClose }: { client: ClientDetail; onClose: () => void }) {
  const invalidate = useInvalidateAdmin();
  const form = useForm<z.input<typeof clientSchema>>({ resolver: zodResolver(clientSchema), mode: "onTouched", defaultValues: client });
  const save = useMutation({
    mutationFn: (v: z.output<typeof clientSchema>) => adminApi(`/admin/clients/${client.id}`, { method: "PUT", body: v }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) for (const [k, m] of Object.entries(err.fields)) form.setError(k as never, { message: m });
    },
  });
  const e = form.formState.errors;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit business details"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="client-form" loading={save.isPending}>Save</Button>
        </>
      }
    >
      <form id="client-form" noValidate className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => save.mutate(v as z.output<typeof clientSchema>))}>
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
        <Field label="Business name" error={e.name?.message}>{(id, d) => <Input id={id} aria-describedby={d} invalid={!!e.name} {...form.register("name")} />}</Field>
        <Field label="Contact person" optional>{(id, d) => <Input id={id} aria-describedby={d} {...form.register("contactName")} />}</Field>
        <Field label="Contact phone" error={e.contactPhone?.message}>{(id, d) => <Input id={id} aria-describedby={d} type="tel" invalid={!!e.contactPhone} {...form.register("contactPhone")} />}</Field>
        <Field label="Billing email" optional error={e.contactEmail?.message}>{(id, d) => <Input id={id} aria-describedby={d} type="email" invalid={!!e.contactEmail} {...form.register("contactEmail")} />}</Field>
        <Field label="Billing GSTIN" optional error={e.billingGstin?.message}>{(id, d) => <Input id={id} aria-describedby={d} invalid={!!e.billingGstin} {...form.register("billingGstin")} />}</Field>
        <Field label="Internal notes" optional>{(id, d) => <Textarea id={id} aria-describedby={d} rows={3} {...form.register("notes")} />}</Field>
      </form>
    </Sheet>
  );
}

/* ---------- Suspend / reactivate ---------- */

function StatusSheet({ client, onClose }: { client: ClientDetail; onClose: () => void }) {
  const invalidate = useInvalidateAdmin();
  const suspending = client.status === "active";
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => adminApi(`/admin/clients/${client.id}/status`, { method: "PATCH", body: { status: suspending ? "suspended" : "active", reason } }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  return (
    <Sheet
      open
      onClose={onClose}
      title={suspending ? `Suspend ${client.name}?` : `Reactivate ${client.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={suspending ? "danger" : "primary"} loading={save.isPending} onClick={() => save.mutate()}>
            {suspending ? `Suspend ${client.name}` : `Reactivate ${client.name}`}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-soft">
        {suspending
          ? "All their staff will be signed out immediately and won't be able to sign in. Their data is kept and nothing is deleted."
          : "Their staff will be able to sign in again. Plans and data are unchanged."}
      </p>
      <div className="mt-4">
        <Field label="Reason" optional hint="Saved in the activity log.">
          {(id, d) => <Input id={id} aria-describedby={d} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
      {save.error && <div className="mt-3"><ErrorNote message={save.error.message} /></div>}
    </Sheet>
  );
}
