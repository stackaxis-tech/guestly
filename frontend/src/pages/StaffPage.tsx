import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Eye, EyeOff, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Sheet, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { canManage, useAuth } from "../lib/auth";
import { useCurrentProperty } from "../lib/property";
import { useStaffList, type StaffMember } from "../lib/reports";
import { PoweredBy } from "../components/PoweredBy";
import { RoleAvatar } from "../components/RoleAvatar";

export const roleDetails: Record<string, { badge: string; label: string; windowDesc: string; explanation: string }> = {
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

export function StaffPage() {
  const { user } = useAuth();
  const property = useCurrentProperty();
  const staff = useStaffList(property.id);
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);
  const manager = canManage(user?.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff & Team"
        description="Give each person their own login. What they can open depends on their role."
        actions={
          manager && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => setEditing("new")}
            >
              Add staff member
            </Button>
          )
        }
      />

      {/* Staff Directory Card */}
      <Card>
        <div className="border-b border-line/70 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">Team{staff.data ? ` (${staff.data.length})` : ""}</h2>
          <p className="text-[13px] text-muted">Each person signs in with their login ID or mobile number.</p>
        </div>

        {staff.isLoading ? (
          <Spinner />
        ) : staff.error ? (
          <div className="p-5">
            <ErrorNote message={staff.error.message} onRetry={() => staff.refetch()} />
          </div>
        ) : !staff.data || staff.data.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No staff accounts found.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {staff.data.map((s) => {
              const roleMeta = roleDetails[s.role] ?? {
                badge: "bg-sand text-muted border-line",
                label: s.role,
                windowDesc: "Standard workspace",
                explanation: "",
              };
              return (
                <li key={s.id} className="flex items-center gap-3.5 px-5 py-4">
                  <RoleAvatar role={s.role} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{s.name}</p>
                    <p className="truncate text-[13px] text-ink-soft">
                      {roleMeta.label}
                      {s.daysPresent > 0 && <span className="text-muted">, {s.daysPresent} days on duty</span>}
                    </p>
                    <p className="truncate text-[13px] text-muted">
                      {s.email}
                      {s.phone && `, ${s.phone}`}
                    </p>
                  </div>
                  {manager && s.role !== "owner" && (
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="pressable flex size-10 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-sand"
                      aria-label={`Edit ${s.name}`}
                    >
                      <Pencil className="size-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* What each role can open */}
      <Card className="mt-5">
        <h2 className="border-b border-line/70 px-5 py-3.5 text-[15px] font-semibold">What each role can open</h2>
        <ul className="divide-y divide-line/70">
          {[
            { role: "manager", title: "Owner & manager", can: "Everything: guests, rooms, bookings, reports, settings, billing and staff logins." },
            { role: "front_desk", title: "Front desk", can: "Check-in, guests, bookings, rooms and their own profile.", not: "No settings, reports or billing." },
            { role: "housekeeping", title: "Housekeeping", can: "Room cleaning status and their own profile.", not: "No guest details or money." },
          ].map((r) => (
            <li key={r.role} className="flex items-start gap-3.5 px-5 py-3.5">
              <RoleAvatar role={r.role} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{r.title}</p>
                <p className="text-[13px] text-ink-soft">{r.can}</p>
                {r.not && <p className="text-[13px] text-muted">{r.not}</p>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <StaffSheet
        staff={editing}
        propertyId={property.id}
        onClose={() => setEditing(null)}
      />

      <PoweredBy className="py-2" />
    </div>
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

export function StaffSheet({
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

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-ink">
            Role & Access Window
          </label>
          {existing?.role === "owner" ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-3.5 text-xs text-brand-900">
              <span className="font-semibold text-brand-800">Owner Account</span>
              <p className="mt-0.5 text-muted">The property owner has full administrative access and their role cannot be changed.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {[
                {
                  role: "front_desk" as const,
                  title: "Front Desk",
                  badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
                  desc: "Check-in, Rooms, Guests, Reservations, Today Session, and Profile.",
                  restriction: "Restricted from Settings, Reports, and Billing.",
                },
                {
                  role: "housekeeping" as const,
                  title: "Housekeeping",
                  badge: "bg-amber-100 text-amber-800 border-amber-300",
                  desc: "Room status/cleaning, Today Session, and Staff Profile only.",
                  restriction: "Restricted from Check-in, Guests, Reservations, Settings, Reports, and Billing.",
                },
                {
                  role: "manager" as const,
                  title: "Manager",
                  badge: "bg-blue-100 text-blue-800 border-blue-300",
                  desc: "Full management access across all hotel operations, Settings, Reports, and Billing.",
                  restriction: "Can manage team accounts and property configurations.",
                },
              ].map((opt) => {
                const isSelected = selectedRole === opt.role;
                return (
                  <button
                    key={opt.role}
                    type="button"
                    onClick={() => {
                      form.setValue("role", opt.role, { shouldValidate: true, shouldDirty: true });
                    }}
                    className={clsx(
                      "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all",
                      isSelected
                        ? "border-brand-700 bg-brand-50/70 ring-2 ring-brand-700/20 shadow-xs"
                        : "border-line bg-paper hover:border-line-strong hover:bg-sand/40",
                    )}
                  >
                    <RoleAvatar role={opt.role} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">{opt.title}</span>
                        <span
                          className={clsx(
                            "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                            isSelected ? "border-brand-700 bg-brand-700 text-white" : "border-line-strong bg-paper",
                          )}
                          aria-hidden
                        >
                          {isSelected && <Check className="size-3.5" strokeWidth={3} />}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink-soft">{opt.desc}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{opt.restriction}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {e.role?.message && (
            <p className="text-[13px] text-danger" role="alert">
              {e.role.message}
            </p>
          )}
          <input type="hidden" {...form.register("role")} />
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
