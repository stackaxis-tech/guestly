import { zodResolver } from "@hookform/resolvers/zod";
import clsx from "clsx";
import { Building2, History, LayoutDashboard, LogOut, Wallet } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { z } from "zod";
import { Logo, LogoMark } from "../components/brand/Logo";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { initials } from "../lib/format";
import { useAdminAuth } from "./lib";

const nav = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/clients", label: "Clients", icon: Building2 },
  { to: "/admin/payments", label: "Payments", icon: Wallet },
  { to: "/admin/activity", label: "Activity", icon: History },
];

function AdminBadge() {
  return (
    <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-bold tracking-wide text-accent-700 uppercase">
      Admin
    </span>
  );
}

export function AdminShell() {
  const { admin, logout } = useAdminAuth();
  const { pathname } = useLocation();

  return (
    <div className="min-h-dvh lg:pl-[232px]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col overflow-y-auto bg-ink text-white/75 lg:flex">
        <div className="flex items-center gap-2 px-5 pt-5 pb-6">
          <Logo size={28} tone="inverse" />
          <AdminBadge />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Admin">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors",
                  isActive ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
                )
              }
            >
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-white/10 p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-400 text-xs font-bold text-ink">
            {initials(admin?.name ?? "")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ivory">{admin?.name}</span>
            <span className="block truncate text-xs text-white/60">{admin?.email}</span>
          </span>
          <button onClick={logout} className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-ink px-4 py-2.5 lg:hidden">
        <span className="flex items-center gap-2">
          <LogoMark size={28} tone="inverse" />
          <AdminBadge />
        </span>
        <button onClick={logout} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-white/75 hover:bg-white/10">
          <LogOut className="size-4" aria-hidden /> Sign out
        </button>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Admin">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx("flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-semibold", isActive ? "text-brand-700" : "text-muted")
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx("rounded-full px-4 py-1", isActive && "bg-brand-50")}>
                  <Icon className="size-5" aria-hidden />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export function AdminLogin() {
  const { login } = useAdminAuth();
  const [formError, setFormError] = useState("");
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), mode: "onTouched" });
  const e = formState.errors;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-2xl bg-paper p-7 shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-2">
          <Logo size={28} />
          <AdminBadge />
        </div>
        <h1 className="mt-6 font-display text-2xl font-bold tracking-tight">Guestlog console</h1>
        <p className="mt-1 text-sm text-muted">Manage hotel clients, plans, and payments.</p>
        <form
          noValidate
          className="mt-6 flex flex-col gap-4"
          onSubmit={handleSubmit(async (v) => {
            setFormError("");
            try {
              await login(v.email, v.password);
            } catch (err) {
              setFormError(err instanceof Error ? err.message : "Couldn't sign in.");
            }
          })}
        >
          {formError && <ErrorNote message={formError} />}
          <Field label="Email" error={e.email?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="username" invalid={!!e.email} {...register("email")} />}
          </Field>
          <Field label="Password" error={e.password?.message}>
            {(id, d) => (
              <Input id={id} aria-describedby={d} type="password" autoComplete="current-password" invalid={!!e.password} {...register("password")} />
            )}
          </Field>
          <Button type="submit" loading={formState.isSubmitting} className="mt-1 w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
