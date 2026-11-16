import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Logo } from "../components/brand/Logo";
import { PoweredBy } from "../components/PoweredBy";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

type LoginValues = z.infer<typeof loginSchema>;

export function AuthPage({ children }: { children?: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <BrandPanel />
      <div className="flex flex-col px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-10">
        <div className="lg:hidden">
          <Logo size={30} />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {children ?? <LoginForm />}
        </div>
        <PoweredBy />
      </div>
    </div>
  );
}

export function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col">
      <Logo size={34} tone="inverse" />
      <div className="mt-auto max-w-md">
        <p className="font-display text-[40px] leading-[1.1] font-medium tracking-tight">
          Every guest,
          <br />
          welcomed{" "}
          <span className="text-brand-400">properly.</span>
        </p>
        <p className="mt-5 text-[15px] leading-relaxed text-white/70">
          Check-ins, rooms, GST invoices and guest reviews for small hotels and homestays, in one calm place.
        </p>

        {/* Free for 30 days card */}
        <div className="mt-8 rounded-xl border border-white/15 bg-white/5 p-5 backdrop-blur-sm">
          <span className="text-xs font-bold tracking-wider text-accent-400 uppercase">Free for 30 days</span>
          <p className="mt-1 text-sm text-white/80">No card needed. Subscribe only when you're ready.</p>
          <Link
            to="/register"
            className="mt-3 inline-flex items-center justify-center rounded-lg bg-accent-400 px-4 py-2 text-xs font-semibold text-ink transition hover:bg-accent-300"
          >
            Start free trial
          </Link>
        </div>
      </div>
      {/* Decorative doorway echoing the logo mark */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-24 size-[420px] text-white/10"
        viewBox="0 0 32 32"
        fill="none"
      >
        <path d="M8.5 20.5V13a7.5 7.5 0 0 1 15 0v11.5a5.5 5.5 0 0 1-5.5 5.5h-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M8.5 20.5h15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="16" cy="13.5" r="2.4" fill="var(--color-brand-700)" opacity="0.9" />
      </svg>
    </div>
  );
}

export function applyFieldErrors<T extends Record<string, unknown>>(
  err: unknown,
  setError: (name: keyof T & string, e: { message: string }) => void,
  setFormError: (m: string) => void,
) {
  if (err instanceof ApiError && err.fields) {
    for (const [k, v] of Object.entries(err.fields)) setError(k as keyof T & string, { message: v });
  } else {
    setFormError(err instanceof Error ? err.message : "Something went wrong.");
  }
}

function LoginForm() {
  const { login } = useAuth();
  const [formError, setFormError] = useState("");
  const { register, handleSubmit, setError, formState } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: "onTouched",
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError("");
    try {
      await login(v.email, v.password);
    } catch (err) {
      applyFieldErrors<LoginValues>(err, setError, setFormError);
    }
  });

  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Welcome back</h1>
      <p className="mt-2 text-[15px] text-muted">Sign in to your front desk.</p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        {formError && <ErrorNote message={formError} />}
        <Field label="Email" error={formState.errors.email?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" invalid={!!formState.errors.email} {...register("email")} />}
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} type="password" autoComplete="current-password" invalid={!!formState.errors.password} {...register("password")} />
          )}
        </Field>
        <div className="-mt-2 text-right">
          <span className="text-xs text-muted hover:text-ink cursor-pointer" title="Contact your Gustlog administrator to reset your password">
            Forgot password?
          </span>
        </div>
        <Button type="submit" loading={formState.isSubmitting} className="mt-2 w-full">
          Sign in
        </Button>
      </form>

      {/* Mobile-only 30-day card */}
      <div className="mt-8 rounded-xl border border-line bg-paper p-4 lg:hidden">
        <span className="text-xs font-bold tracking-wider text-accent-700 uppercase">Free for 30 days</span>
        <p className="mt-1 text-sm text-muted">No card needed. Subscribe only when you're ready.</p>
        <Link
          to="/register"
          className="mt-3 inline-flex items-center justify-center rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-white transition hover:bg-ink/90"
        >
          Start free trial
        </Link>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        New hotel?{" "}
        <Link to="/register" className="font-semibold text-brand-700 hover:text-brand-800">
          Start your free trial
        </Link>
      </p>
    </>
  );
}
