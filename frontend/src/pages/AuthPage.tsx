import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Logo } from "../components/brand/Logo";
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
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Logo size={30} />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {children ?? <LoginForm />}
        </div>
      </div>
    </div>
  );
}

export function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-teal-800 p-12 text-ivory lg:flex lg:flex-col">
      <Logo size={34} tone="inverse" />
      <div className="mt-auto max-w-md">
        <p className="font-display text-[40px] leading-[1.1] font-medium tracking-tight">
          Every guest,
          <br />
          welcomed{" "}
          <span className="text-marigold-300 italic">properly.</span>
        </p>
        <p className="mt-5 text-[15px] leading-relaxed text-teal-100">
          Check-ins, rooms, GST invoices and guest reviews for small hotels and homestays, in one calm place.
        </p>
      </div>
      {/* Decorative doorway echoing the logo mark */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-24 size-[420px] text-teal-700"
        viewBox="0 0 32 32"
        fill="none"
      >
        <path d="M8.5 20.5V13a7.5 7.5 0 0 1 15 0v11.5a5.5 5.5 0 0 1-5.5 5.5h-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M8.5 20.5h15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="16" cy="13.5" r="2.4" fill="var(--color-marigold-400)" opacity="0.9" />
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
      <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
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
        <Button type="submit" loading={formState.isSubmitting} className="mt-2 w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        New hotel? Guestly sets up your account and sends you an invite link.
      </p>
    </>
  );
}
