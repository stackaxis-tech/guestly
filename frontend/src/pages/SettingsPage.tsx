import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, EyeOff, Pencil, Plus, Shield } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Sheet, Spinner, Textarea } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { canManage, useAuth } from "../lib/auth";
import { clock12, rupees, toPaise } from "../lib/format";
import { useCurrentProperty, type Property } from "../lib/property";
import { LogoPicker } from "../components/PropertyLogo";
import { PoweredBy } from "../components/PoweredBy";
import { useRoomTypes, type RoomType } from "../lib/rooms";
import { useStaffList, type StaffMember } from "../lib/reports";

export function SettingsPage() {
  const { user } = useAuth();
  const manager = canManage(user?.role);
  return (
    <>
      <PageHeader title="Settings" description="Property details used on invoices, staff logins, and how your rooms are priced." />
      <div className="flex flex-col gap-6">
        <PlanCard />
        <StaffCard readOnly={!manager} />
        <LogoCard readOnly={!manager} />
        <FrontDeskCard readOnly={!manager} />
        <MessagesCard readOnly={!manager} />
        <PropertyForm readOnly={!manager} />
        <RoomTypes readOnly={!manager} />
        <PoweredBy className="py-2" />
      </div>
    </>
  );
}

function SectionHeader({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

const propertySchema = z.object({
  name: z.string().trim().min(1, "Enter the property name."),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  pincode: z.string().trim().regex(/^([1-9][0-9]{5})?$/, "PIN code should be 6 digits."),
  phone: z.string(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email.")]),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/, "GSTIN should be 15 characters, like 29ABCDE1234F1Z5."),
  googleReviewUrl: z.union([z.literal(""), z.string().trim().url("Paste the full https:// link.")]),
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, "Up to 10 letters, numbers, or dashes."),
  checkInTime: z.string(),
  checkOutTime: z.string(),
});
type PropertyValues = z.input<typeof propertySchema>;

function PropertyForm({ readOnly }: { readOnly: boolean }) {
  const property = useCurrentProperty();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const { id: _id, logoUrl: _l, subscription: _s, billing: _b, ...values } = property;
  const form = useForm<PropertyValues>({ resolver: zodResolver(propertySchema), mode: "onTouched", values });

  const save = useMutation({
    mutationFn: (v: z.output<typeof propertySchema>) => api<Property>(`/properties/${property.id}/`, { method: "PUT", body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields)
        for (const [k, v] of Object.entries(err.fields)) form.setError(k as keyof PropertyValues, { message: v });
    },
  });

  const e = form.formState.errors;
  const text = (name: keyof PropertyValues, label: string, opts: { optional?: boolean; hint?: string; placeholder?: string; type?: string; className?: string } = {}) => (
    <Field label={label} optional={opts.optional} hint={opts.hint} error={e[name]?.message} className={opts.className}>
      {(id, d) => (
        <Input id={id} aria-describedby={d} type={opts.type} placeholder={opts.placeholder} disabled={readOnly} invalid={!!e[name]} {...form.register(name)} />
      )}
    </Field>
  );

  return (
    <Card>
      <SectionHeader title="Property profile" body="Shown on GST invoices and the guest review page." />
      <form onSubmit={form.handleSubmit((v) => save.mutate(v as z.output<typeof propertySchema>))} noValidate>
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          {text("name", "Property name", { className: "sm:col-span-2" })}
          <Field label="Address" optional className="sm:col-span-2">
            {(id, d) => <Textarea id={id} aria-describedby={d} disabled={readOnly} rows={2} {...form.register("address")} />}
          </Field>
          {text("city", "City", { optional: true })}
          {text("state", "State", { optional: true, hint: "Decides CGST + SGST or IGST on invoices." })}
          {text("pincode", "PIN code", { optional: true })}
          {text("phone", "Phone", { optional: true, type: "tel", placeholder: "+91 98xxx xxxxx" })}
          {text("email", "Email", { optional: true, type: "email" })}
          {text("gstin", "GSTIN", { optional: true, placeholder: "29ABCDE1234F1Z5" })}
          {text("invoicePrefix", "Invoice prefix", { hint: "Invoices will be numbered like HH/2026-27/0001." })}
          {text("googleReviewUrl", "Google review link", {
            optional: true,
            placeholder: "https://g.page/r/…/review",
            hint: "Happy guests (4–5★) are invited to post here.",
          })}
          {text("checkInTime", "Standard check-in", { type: "time" })}
          {text("checkOutTime", "Standard checkout", { type: "time" })}
        </div>
        {!readOnly && (
          <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-4">
            {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
            {saved && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-ready" role="status">
                <Check className="size-4" /> Saved
              </span>
            )}
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
              Save profile
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function RoomTypes({ readOnly }: { readOnly: boolean }) {
  const property = useCurrentProperty();
  const types = useRoomTypes(property.id);
  const [editing, setEditing] = useState<RoomType | "new" | null>(null);

  return (
    <Card>
      <SectionHeader
        title="Room types"
        body="Base nightly rates before GST. You can still adjust the rate at check-in."
        action={!readOnly && <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Add type</Button>}
      />
      {types.isLoading ? (
        <Spinner />
      ) : types.error ? (
        <div className="p-5"><ErrorNote message={types.error.message} onRetry={() => types.refetch()} /></div>
      ) : types.data!.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">No room types yet. Add one, like “Deluxe · Queen bed”.</p>
      ) : (
        <ul className="divide-y divide-line">
          {types.data!.map((t) => (
            <li key={t.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.name}</p>
                <p className="text-sm text-muted">
                  {[t.bedType, `up to ${t.maxGuests} guests`, `${t.roomCount} ${t.roomCount === 1 ? "room" : "rooms"}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <p className="tabular font-semibold">
                {rupees(t.baseRate)}
                <span className="text-sm font-normal text-muted"> /night</span>
              </p>
              {!readOnly && (
                <Button variant="ghost" size="sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                  <Pencil className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <RoomTypeForm type={editing} propertyId={property.id} onClose={() => setEditing(null)} />
    </Card>
  );
}

const typeSchema = z.object({
  name: z.string().trim().min(1, "Enter a name, like Deluxe."),
  bedType: z.string().trim(),
  rate: z.string().refine((s) => toPaise(s) !== null, "Enter an amount, like 3500."),
  maxGuests: z.coerce.number().int().min(1, "At least 1.").max(20, "At most 20."),
});
type TypeValues = z.input<typeof typeSchema>;

function RoomTypeForm({ type, propertyId, onClose }: { type: RoomType | "new" | null; propertyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = type && type !== "new" ? type : null;
  const form = useForm<TypeValues>({
    resolver: zodResolver(typeSchema),
    mode: "onTouched",
    values: existing
      ? { name: existing.name, bedType: existing.bedType, rate: String(existing.baseRate / 100), maxGuests: existing.maxGuests }
      : { name: "", bedType: "", rate: "", maxGuests: 2 },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["room-types", propertyId] });
    qc.invalidateQueries({ queryKey: ["rooms", propertyId] });
  };
  const save = useMutation({
    mutationFn: (v: z.output<typeof typeSchema>) => {
      const body = { name: v.name, bedType: v.bedType, baseRate: toPaise(v.rate)!, maxGuests: v.maxGuests };
      return existing
        ? api(`/properties/${propertyId}/room-types/${existing.id}`, { method: "PUT", body })
        : api(`/properties/${propertyId}/room-types`, { method: "POST", body });
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields)
        for (const [k, v] of Object.entries(err.fields)) form.setError((k === "baseRate" ? "rate" : k) as keyof TypeValues, { message: v });
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/properties/${propertyId}/room-types/${existing!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const e = form.formState.errors;
  return (
    <Sheet
      open={type !== null}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "Add a room type"}
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              className="mr-auto text-danger hover:bg-danger-bg hover:text-danger"
              loading={remove.isPending}
              onClick={() => confirm(`Delete the “${existing.name}” room type?`) && remove.mutate()}
            >
              Delete {existing.name}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="type-form" loading={save.isPending}>
            {existing ? "Save changes" : "Add type"}
          </Button>
        </>
      }
    >
      <form id="type-form" onSubmit={form.handleSubmit((v) => save.mutate(v as z.output<typeof typeSchema>))} className="flex flex-col gap-4" noValidate>
        {remove.error && <ErrorNote message={remove.error.message} />}
        <Field label="Name" error={e.name?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} placeholder="Deluxe" invalid={!!e.name} {...form.register("name")} />}
        </Field>
        <Field label="Bed" optional>
          {(id, d) => <Input id={id} aria-describedby={d} placeholder="Queen bed" {...form.register("bedType")} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nightly rate" error={e.rate?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" placeholder="3500" invalid={!!e.rate} {...form.register("rate")} />}
          </Field>
          <Field label="Max guests" error={e.maxGuests?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" invalid={!!e.maxGuests} {...form.register("maxGuests")} />}
          </Field>
        </div>
      </form>
    </Sheet>
  );
}

function PlanCard() {
  const property = useCurrentProperty();
  const s = property.subscription;
  const b = property.billing;
  if (!s || !b) return null;
  const plan = s.plan === "annual" ? "Annual" : s.plan === "monthly" ? "Monthly" : `Every ${s.periodMonths} months`;
  const ends = new Date(s.endsOn.slice(0, 10) + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const label: Record<string, [string, string]> = {
    trial: ["Free trial", "bg-brand-50 text-brand-700"],
    active: ["Active", "bg-ready-bg text-ready"],
    grace: ["Renewal due", "bg-accent-50 text-accent-700"],
    expired: ["Expired · read-only", "bg-danger-bg text-danger"],
  };
  const [text, cls] = label[b.state];
  return (
    <Card>
      <SectionHeader title="Your Gustlog plan" body="Billed per property. To renew or change your plan, contact Gustlog." />
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <div>
          <p className="text-xs text-muted">Plan</p>
          <p className="font-semibold">
            {plan} · <span className="tabular">{rupees(s.amount)}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">{b.state === "trial" ? "Trial ends" : b.daysLeft < 0 ? "Ended on" : "Paid until"}</p>
          <p className="font-semibold">{ends}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{text}</span>
      </div>
    </Card>
  );
}

const roleDetails: Record<string, { badge: string; label: string; windowDesc: string; explanation: string }> = {
  owner: {
    badge: "bg-brand-50 text-brand-700 border-brand-200",
    label: "Owner",
    windowDesc: "Full administrative access (all operations, settings, billing & reports)",
    explanation: "Full administrative control of property setup, subscription plans, settings, and team logins.",
  },
  manager: {
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    label: "Manager",
    windowDesc: "Management window (operations, settings, reports & billing)",
    explanation: "Can manage all front-desk operations, room setup, staff accounts, reports, and bills.",
  },
  front_desk: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    label: "Front Desk",
    windowDesc: "Front Desk window (Today, Rooms, Guests, Reservations, Check-in & Profile)",
    explanation: "Restricted window: Operates daily guest check-ins, rooms, reservations, and guests. Restricted from Settings, Reports, and Billing.",
  },
  housekeeping: {
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    label: "Housekeeping",
    windowDesc: "Housekeeping window (Today, Rooms & Profile only)",
    explanation: "Restricted window: Access only to room readiness, daily session status, and staff attendance. Restricted from Check-in, Guests, Reservations, Settings, Reports, and Billing.",
  },
};

function StaffCard({ readOnly }: { readOnly: boolean }) {
  const property = useCurrentProperty();
  const staff = useStaffList(property.id);
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);

  return (
    <Card>
      <SectionHeader
        title="Staff & Team"
        body="Create staff logins with their own login ID and password. Non-manager staff are restricted to their designated window."
        action={
          !readOnly && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => setEditing("new")}
            >
              Add staff
            </Button>
          )
        }
      />
      {staff.isLoading ? (
        <Spinner />
      ) : staff.error ? (
        <div className="p-5">
          <ErrorNote message={staff.error.message} onRetry={() => staff.refetch()} />
        </div>
      ) : !staff.data || staff.data.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">No staff accounts found.</p>
      ) : (
        <ul className="divide-y divide-line">
          {staff.data.map((s) => {
            const roleMeta = roleDetails[s.role] ?? {
              badge: "bg-sand text-muted border-line",
              label: s.role,
              windowDesc: "Standard workspace",
              explanation: "",
            };
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700 border border-brand-200">
                    {s.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{s.name}</span>
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold border ${roleMeta.badge}`}>
                        {roleMeta.label}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span className="font-mono bg-sand/60 px-1.5 py-0.5 rounded text-ink-soft">
                        Login ID: {s.email}
                      </span>
                      {s.phone && <span>Phone: {s.phone}</span>}
                      {s.daysPresent > 0 && <span>{s.daysPresent} days on duty</span>}
                    </div>
                    <p className="mt-1.5 text-xs text-muted">{roleMeta.windowDesc}</p>
                  </div>
                </div>
                {!readOnly && (
                  <div>
                    {s.role === "owner" ? (
                      <span className="text-xs font-medium text-muted">Primary Owner</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="size-3.5" />}
                        onClick={() => setEditing(s)}
                      >
                        Edit / Reset
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <StaffSheet
        staff={editing}
        propertyId={property.id}
        onClose={() => setEditing(null)}
      />
    </Card>
  );
}

const staffSchema = z.object({
  name: z.string().trim().min(2, "Staff name must be at least 2 characters."),
  role: z.enum(["front_desk", "housekeeping", "manager", "owner"]),
  email: z.string().trim().min(1, "Enter a login ID or email."),
  phone: z.string().trim().optional(),
  password: z.string().optional(),
});
type StaffFormValues = z.infer<typeof staffSchema>;

function StaffSheet({
  staff,
  propertyId,
  onClose,
}: {
  staff: StaffMember | "new" | null;
  propertyId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const existing = staff && staff !== "new" ? staff : null;
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");

  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffSchema),
    mode: "onTouched",
    values: existing
      ? {
          name: existing.name,
          role: existing.role as "front_desk" | "housekeeping" | "manager" | "owner",
          email: existing.email,
          phone: existing.phone ?? "",
          password: "",
        }
      : {
          name: "",
          role: "front_desk",
          email: "",
          phone: "",
          password: "",
        },
  });

  const selectedRole = form.watch("role") || (existing ? existing.role : "front_desk");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["staff-list", propertyId] });
    qc.invalidateQueries({ queryKey: ["attendance-report", propertyId] });
  };

  const save = useMutation({
    mutationFn: async (v: StaffFormValues) => {
      setFormError("");
      if (!existing && (!v.password || v.password.trim().length < 6)) {
        form.setError("password", { message: "Password must be at least 6 characters." });
        throw new Error("Password must be at least 6 characters.");
      }
      if (existing && v.password && v.password.trim().length > 0 && v.password.trim().length < 6) {
        form.setError("password", { message: "Password must be at least 6 characters." });
        throw new Error("Password must be at least 6 characters.");
      }

      if (existing) {
        return api<StaffMember>(`/properties/${propertyId}/staff/${existing.id}`, {
          method: "PUT",
          body: {
            name: v.name,
            role: v.role,
            phone: v.phone?.trim() || undefined,
            password: v.password?.trim() || undefined,
          },
        });
      } else {
        return api<StaffMember>(`/properties/${propertyId}/staff`, {
          method: "POST",
          body: {
            name: v.name,
            role: v.role,
            email: v.email.trim(),
            phone: v.phone?.trim() || undefined,
            password: v.password?.trim(),
          },
        });
      }
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) {
        for (const [k, v] of Object.entries(err.fields)) {
          form.setError(k as keyof StaffFormValues, { message: v });
        }
      } else if (err instanceof Error) {
        setFormError(err.message);
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/properties/${propertyId}/staff/${existing!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      if (err instanceof Error) setFormError(err.message);
    },
  });

  const e = form.formState.errors;

  return (
    <Sheet
      open={staff !== null}
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : "Add staff member"}
      description={
        existing
          ? "Update staff details, modify their assigned role, or reset their login password."
          : "Create staff credentials for your front desk or housekeeping team."
      }
      footer={
        <>
          {existing && existing.role !== "owner" && (
            <Button
              variant="ghost"
              type="button"
              className="mr-auto text-danger hover:bg-danger-bg hover:text-danger"
              loading={remove.isPending}
              onClick={() => confirm(`Are you sure you want to remove ${existing.name}? They will no longer be able to log in.`) && remove.mutate()}
            >
              Remove staff
            </Button>
          )}
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="staff-form" loading={save.isPending}>
            {existing ? "Save changes" : "Create staff"}
          </Button>
        </>
      }
    >
      <form
        id="staff-form"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
        className="flex flex-col gap-4"
        noValidate
      >
        {formError && <ErrorNote message={formError} />}
        {remove.error && <ErrorNote message={remove.error.message} />}

        <Field label="Full name" error={e.name?.message}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              placeholder="e.g. Ramesh Kumar"
              invalid={!!e.name}
              {...form.register("name")}
            />
          )}
        </Field>

        <Field label="Role & Access Window" error={e.role?.message}>
          {(id, d) => (
            <Select
              id={id}
              aria-describedby={d}
              disabled={existing?.role === "owner"}
              invalid={!!e.role}
              {...form.register("role")}
            >
              {existing?.role === "owner" ? (
                <option value="owner">Owner (Full administrative access)</option>
              ) : (
                <>
                  <option value="front_desk">Front Desk (Check-in, Rooms, Guests, Reservations, Today)</option>
                  <option value="housekeeping">Housekeeping (Rooms & Today only)</option>
                  <option value="manager">Manager (Full operations, Settings & Reports)</option>
                </>
              )}
            </Select>
          )}
        </Field>

        {/* Role window explainer banner */}
        <div className="rounded-lg border border-brand-200 bg-brand-50/70 p-3 text-xs text-brand-900">
          <p className="font-semibold text-brand-800 flex items-center gap-1.5">
            <Shield className="size-3.5 shrink-0" />
            {roleDetails[selectedRole]?.label ?? selectedRole} Access Window
          </p>
          <p className="mt-1 leading-relaxed text-brand-900">
            {roleDetails[selectedRole]?.explanation}
          </p>
        </div>

        <Field
          label="Login ID or Email"
          error={e.email?.message}
          hint={existing ? "Login ID cannot be changed once created." : "Staff will enter this Login ID or their phone number at /login."}
        >
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              disabled={!!existing}
              placeholder="e.g. ramesh.desk or frontdesk@hotel.com"
              invalid={!!e.email}
              {...form.register("email")}
            />
          )}
        </Field>

        <Field
          label="Mobile phone"
          optional
          error={e.phone?.message}
          hint="Staff can also use this 10-digit number to sign in."
        >
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="tel"
              placeholder="9876543210"
              invalid={!!e.phone}
              {...form.register("phone")}
            />
          )}
        </Field>

        <Field
          label={existing ? "Reset password" : "Login password"}
          optional={!!existing}
          error={e.password?.message}
          hint={
            existing
              ? "Leave empty to keep current password. Enter at least 6 characters to reset."
              : "Minimum 6 characters. Give this password to the staff member."
          }
        >
          {(id, d) => (
            <div className="relative">
              <Input
                id={id}
                aria-describedby={d}
                type={showPassword ? "text" : "password"}
                placeholder={existing ? "Leave blank to keep existing password" : "••••••••"}
                className="pr-10"
                invalid={!!e.password}
                {...form.register("password")}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink focus:outline-none"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>
      </form>
    </Sheet>
  );
}

function LogoCard({ readOnly }: { readOnly: boolean }) {
  const property = useCurrentProperty();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["properties"] });
    setFile(null);
  };
  const upload = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("logo", f);
      return api(`/properties/${property.id}/logo`, { method: "POST", form: fd });
    },
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api(`/properties/${property.id}/logo`, { method: "DELETE" }),
    onSuccess: done,
  });
  const fieldError = upload.error instanceof ApiError ? upload.error.fields?.logo ?? upload.error.message : undefined;

  return (
    <Card>
      <SectionHeader title="Logo" body="Shown in your Gustlog app, on invoices, and on the guest review page." />
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
        {readOnly ? (
          <p className="text-sm text-muted">Only owners and managers can change the logo.</p>
        ) : (
          <LogoPicker
            name={property.name}
            currentUrl={property.logoUrl || undefined}
            file={file}
            onChange={setFile}
            onRemove={() => remove.mutate()}
            error={fieldError}
            busy={upload.isPending || remove.isPending}
          />
        )}
        {file && (
          <Button loading={upload.isPending} onClick={() => upload.mutate(file)}>
            Save logo
          </Button>
        )}
      </div>
    </Card>
  );
}

const graceText = (m: number) => (m === 0 ? "a minute" : m < 60 ? `${m} minutes` : m === 60 ? "an hour" : `${m / 60} hours`);

function FrontDeskCard({ readOnly }: { readOnly: boolean }) {
  const property = useCurrentProperty();
  const qc = useQueryClient();
  const fd = property.frontDesk;
  const [v, setV] = useState({ ...fd, threshold: String(fd.roomGstThreshold / 100) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api(`/properties/${property.id}/front-desk`, {
        method: "PUT",
        body: {
          whatsappNumber: v.whatsappNumber,
          whatsappOpenIn: v.whatsappOpenIn,
          wifiName: v.wifiName,
          wifiPassword: v.wifiPassword,
          gstRegistered: v.gstRegistered,
          roomGstThreshold: toPaise(v.threshold) ?? -1,
          roomGstLow: Number(v.roomGstLow),
          roomGstHigh: Number(v.roomGstHigh),
          serviceGstRate: Number(v.serviceGstRate),
          legalName: v.legalName,
          invoiceFooter: v.invoiceFooter,
          checkoutPolicy: v.checkoutPolicy,
          earlyArrivalCutoff: v.earlyArrivalCutoff,
          lateCheckoutGrace: Number(v.lateCheckoutGrace),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["properties"] });
      setErrors({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => err instanceof ApiError && err.fields && setErrors(err.fields),
  });
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  // Say the slabs in rupees so nobody has to decode "≤" and ">".
  const limitPaise = toPaise(v.threshold);
  const limit = limitPaise !== null ? rupees(limitPaise) : "the limit";
  const rateSelect = (k: "roomGstLow" | "roomGstHigh" | "serviceGstRate", label: string, hint?: string) => (
    <Field label={label} error={errors[k]} hint={hint}>
      {(id, d) => (
        <Select id={id} aria-describedby={d} disabled={readOnly || !v.gstRegistered} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}>
          {[0, 5, 12, 18, 28].map((r) => (
            <option key={r} value={r}>
              {r}%
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  return (
    <Card>
      <SectionHeader title="Front desk, WhatsApp & GST" body="Used in guest messages and on every bill." />
      <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        <Field label="Hotel WhatsApp number" optional hint="Shown to guests in messages.">
          {(id, d) => <Input id={id} aria-describedby={d} type="tel" disabled={readOnly} value={v.whatsappNumber} onChange={set("whatsappNumber")} />}
        </Field>
        <Field label="Open WhatsApp in" hint="Use WhatsApp Web if your front desk computer has it open.">
          {(id, d) => (
            <Select id={id} aria-describedby={d} disabled={readOnly} value={v.whatsappOpenIn} onChange={set("whatsappOpenIn")}>
              <option value="app">WhatsApp app</option>
              <option value="web">WhatsApp Web</option>
            </Select>
          )}
        </Field>
        <Field label="Wi-Fi name" optional>
          {(id, d) => <Input id={id} aria-describedby={d} disabled={readOnly} value={v.wifiName} onChange={set("wifiName")} />}
        </Field>
        <Field label="Wi-Fi password" optional>
          {(id, d) => <Input id={id} aria-describedby={d} disabled={readOnly} value={v.wifiPassword} onChange={set("wifiPassword")} />}
        </Field>
        <div className="flex flex-col gap-4 rounded-lg border border-line px-4 py-4 sm:col-span-2">
          <div>
            <p className="text-sm font-semibold">Check-in & checkout rules</p>
            <p className="text-sm text-muted">How nights are counted on bills. Guests already in-house keep the rules they checked in under.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Checkout rule" error={errors.checkoutPolicy}>
              {(id, d) => (
                <Select id={id} aria-describedby={d} disabled={readOnly} value={v.checkoutPolicy} onChange={(e) => setV({ ...v, checkoutPolicy: e.target.value as "fixed" | "24h" })}>
                  <option value="fixed">Fixed time ({clock12(property.checkOutTime)})</option>
                  <option value="24h">24 hours from check-in</option>
                </Select>
              )}
            </Field>
            {v.checkoutPolicy === "fixed" && (
              <Field label="Night arrivals before" error={errors.earlyArrivalCutoff} hint="Count as the previous night">
                {(id, d) => (
                  <Select id={id} aria-describedby={d} disabled={readOnly} value={v.earlyArrivalCutoff} onChange={set("earlyArrivalCutoff")}>
                    <option value="00:00">Off</option>
                    {["04:00", "05:00", "06:00", "07:00", "08:00"].map((t) => (
                      <option key={t} value={t}>
                        {clock12(t)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label={v.checkoutPolicy === "fixed" ? "Late checkout after" : "Grace before next night"} error={errors.lateCheckoutGrace}>
              {(id, d) => (
                <Select id={id} aria-describedby={d} disabled={readOnly} value={String(v.lateCheckoutGrace)} onChange={(e) => setV({ ...v, lateCheckoutGrace: Number(e.target.value) })}>
                  {[0, 30, 60, 90, 120, 180].map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? "No grace" : m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? "" : "s"}`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800" role="status">
            {v.checkoutPolicy === "fixed" ? (
              <>
                Guests check in from <strong>{clock12(property.checkInTime)}</strong> and leave by <strong>{clock12(property.checkOutTime)}</strong>; one night per date.
                {v.earlyArrivalCutoff !== "00:00" && (
                  <> A walk-in before {clock12(v.earlyArrivalCutoff)} is billed from the previous night (e.g. arriving 2 AM on the 18th, the night of the 17th).</>
                )}{" "}
                Leaving more than {graceText(v.lateCheckoutGrace)} after {clock12(property.checkOutTime)} shows as a late checkout, with an option to add a half-day charge.
              </>
            ) : (
              <>
                One night per 24 hours from the check-in time: in at 7:40 PM, due out 7:40 PM. Staying more than {graceText(v.lateCheckoutGrace)} past that adds another night.
              </>
            )}
          </p>
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-line px-4 py-3 sm:col-span-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" disabled={readOnly} checked={v.gstRegistered} onChange={(e) => setV({ ...v, gstRegistered: e.target.checked })} />
          <span className="text-sm">
            <span className="font-semibold">GST registered: charge GST on bills</span>
            <span className="block text-muted">Room GST depends on the nightly rate. Confirm the rates with your CA.</span>
          </span>
        </label>
        <Field label="Room rate limit for GST (per night)" error={errors.roomGstThreshold} hint="The nightly room rate where the higher GST starts." className="sm:col-span-2">
          {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" disabled={readOnly || !v.gstRegistered} value={v.threshold} onChange={set("threshold")} />}
        </Field>
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
          {rateSelect("roomGstLow", `GST on rooms up to ${limit}`, `Rate of ${limit} or less per night`)}
          {rateSelect("roomGstHigh", `GST on rooms above ${limit}`, `Rate more than ${limit} per night`)}
          {rateSelect("serviceGstRate", "GST on other charges", "Food, laundry, extra bed…")}
        </div>
        {v.gstRegistered && limitPaise !== null && (
          <p className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800 sm:col-span-2" role="status">
            A room at <strong>{limit}</strong> or less per night is billed <strong>{v.roomGstLow}% GST</strong>. A room above {limit} is billed{" "}
            <strong>{v.roomGstHigh}% GST</strong>. Other charges are billed <strong>{v.serviceGstRate}% GST</strong>.
          </p>
        )}
      </div>
      <div className="grid gap-4 border-t border-line px-5 py-5">
        <div>
          <h3 className="text-sm font-semibold">Invoice</h3>
          <p className="text-sm text-muted">Printed on every guest invoice, next to your logo and GSTIN.</p>
        </div>
        <Field label="Name registered under GST" optional error={errors.legalName} hint="Leave empty to use the property name.">
          {(id, d) => <Input id={id} aria-describedby={d} disabled={readOnly} value={v.legalName} onChange={set("legalName")} invalid={!!errors.legalName} />}
        </Field>
        <Field label="Footer note" optional error={errors.invoiceFooter} hint="Terms or a thank-you line at the bottom of the invoice.">
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} disabled={readOnly} value={v.invoiceFooter} onChange={set("invoiceFooter")} invalid={!!errors.invoiceFooter} />}
        </Field>
      </div>
      {!readOnly && (
        <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-4">
          {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
          {saved && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-ready" role="status">
              <Check className="size-4" /> Saved
            </span>
          )}
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      )}
    </Card>
  );
}

type Tpl = { kind: string; title: string; when: string; defaultBody: string; available: boolean; enabled: boolean; body: string; custom: boolean };
type TplResp = { templates: Tpl[]; variables: { name: string; sample: string }[] };

function MessagesCard({ readOnly }: { readOnly: boolean }) {
  const property = useCurrentProperty();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["templates", property.id], queryFn: () => api<TplResp>(`/properties/${property.id}/message-templates`) });
  const [editing, setEditing] = useState<Tpl | null>(null);

  return (
    <Card>
      <SectionHeader title="WhatsApp messages" body="The wording sent to guests. Staff always see a preview before WhatsApp opens." />
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <div className="p-5"><ErrorNote message={q.error.message} /></div>
      ) : (
        <ul className="divide-y divide-line">
          {q.data!.templates.map((t) => (
            <li key={t.kind} className="flex items-center gap-3 px-5 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t.title}</span>
                <span className="block text-sm text-muted">
                  {t.when}
                  {t.custom && " · customised"}
                </span>
              </span>
              {!t.available ? (
                <span className="rounded-full bg-sand px-2.5 py-0.5 text-xs font-semibold text-muted">Coming soon</span>
              ) : (
                <>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.enabled ? "bg-ready-bg text-ready" : "bg-sand text-muted"}`}>{t.enabled ? "On" : "Off"}</span>
                  {!readOnly && (
                    <Button size="sm" variant="ghost" aria-label={`Edit ${t.title}`} onClick={() => setEditing(t)}>
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && q.data && (
        <TemplateSheet
          tpl={editing}
          vars={q.data.variables}
          propertyId={property.id}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            qc.setQueryData(["templates", property.id], r);
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

function renderSample(body: string, vars: { name: string; sample: string }[]) {
  const map = Object.fromEntries(vars.map((v) => [v.name, v.sample]));
  return body.replace(/\{([a-z_]+)\}/g, (m, k: string) => map[k] ?? m);
}

function TemplateSheet({ tpl, vars, propertyId, onClose, onSaved }: { tpl: Tpl; vars: { name: string; sample: string }[]; propertyId: string; onClose: () => void; onSaved: (r: TplResp) => void }) {
  const [body, setBody] = useState(tpl.body);
  const [enabled, setEnabled] = useState(tpl.enabled);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => api<TplResp>(`/properties/${propertyId}/message-templates/${tpl.kind}`, { method: "PUT", body: { enabled, body } }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof ApiError ? err.fields?.body ?? err.message : "Couldn't save."),
  });
  const reset = useMutation({
    mutationFn: () => api<TplResp>(`/properties/${propertyId}/message-templates/${tpl.kind}`, { method: "DELETE" }),
    onSuccess: onSaved,
  });
  const insert = (name: string) => setBody((b) => `${b}{${name}}`);

  return (
    <Sheet
      open
      onClose={onClose}
      title={tpl.title}
      description={tpl.when}
      footer={
        <>
          {tpl.custom && (
            <Button variant="ghost" className="mr-auto" loading={reset.isPending} onClick={() => reset.mutate()}>
              Reset to default
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save message</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-700" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Offer this message to staff
        </label>
        <Field label="Message" error={error}>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={10} value={body} onChange={(e) => setBody(e.target.value)} invalid={!!error} />}
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted">Tap to insert a field</p>
          <div className="flex flex-wrap gap-1.5">
            {vars.map((v) => (
              <button key={v.name} type="button" onClick={() => insert(v.name)} className="rounded-md border border-line-strong px-2 py-0.5 font-mono text-xs hover:bg-sand">
                {"{" + v.name + "}"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted">Preview with sample details</p>
          <div className="rounded-xl bg-[#e7f6e4] p-3">
            <p className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm whitespace-pre-wrap shadow-sm">{renderSample(body, vars)}</p>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
