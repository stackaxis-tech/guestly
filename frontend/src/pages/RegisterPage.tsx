import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { Logo } from "../components/brand/Logo";
import { PoweredBy } from "../components/PoweredBy";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { useAuth } from "../lib/auth";
import { BrandPanel, applyFieldErrors } from "./AuthPage";

const registerSchema = z.object({
  hotelName: z.string().trim().min(2, "Hotel name must be between 2 and 100 characters.").max(100, "Hotel name must be between 2 and 100 characters."),
  name: z.string().trim().min(2, "Your name must be between 2 and 80 characters.").max(80, "Your name must be between 2 and 80 characters."),
  email: z.string().trim().email("Enter a valid email address."),
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+91)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms and Privacy Policy to continue." }),
  }),
});

type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <BrandPanel />
      <div className="flex flex-col px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-10">
        <div className="lg:hidden">
          <Logo size={30} />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <RegisterForm />
        </div>
        <PoweredBy />
      </div>
    </div>
  );
}

function RegisterForm() {
  const { register: registerUser } = useAuth();
  const [formError, setFormError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [duplicateEmail, setDuplicateEmail] = useState(false);

  const { register, handleSubmit, setError, formState } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: "onBlur",
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError("");
    setDuplicateEmail(false);
    try {
      await registerUser(v);
    } catch (err) {
      applyFieldErrors<RegisterValues>(err, setError, (msg) => {
        if (msg.toLowerCase().includes("email already exists")) {
          setDuplicateEmail(true);
        } else {
          setFormError(msg);
        }
      });
      if (formState.errors.email?.message?.toLowerCase().includes("already exists")) {
        setDuplicateEmail(true);
      }
    }
  });

  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight">Start your free trial</h1>
      <p className="mt-2 text-[15px] text-muted">30 days free. No card needed.</p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        {formError && <ErrorNote message={formError} />}

        {duplicateEmail && (
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
            An account with this email already exists.{" "}
            <Link to="/login" className="font-semibold underline hover:text-brand-700">
              Sign in instead
            </Link>
            .
          </div>
        )}

        <Field label="Hotel / property name" error={formState.errors.hotelName?.message}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="text"
              autoComplete="organization"
              placeholder="e.g. Hilltop Heritage Homestay"
              invalid={!!formState.errors.hotelName}
              {...register("hotelName")}
            />
          )}
        </Field>

        <Field label="Your name" error={formState.errors.name?.message}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="text"
              autoComplete="name"
              placeholder="Your full name"
              invalid={!!formState.errors.name}
              {...register("name")}
            />
          )}
        </Field>

        <Field label="Email" error={formState.errors.email?.message}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              invalid={!!formState.errors.email}
              {...register("email")}
            />
          )}
        </Field>

        <Field label="Phone" error={formState.errors.phone?.message}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="tel"
              autoComplete="tel"
              placeholder="10-digit mobile number"
              invalid={!!formState.errors.phone}
              {...register("phone")}
            />
          )}
        </Field>

        <Field label="Password" error={formState.errors.password?.message}>
          {(id, d) => (
            <div className="relative">
              <Input
                id={id}
                aria-describedby={d}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                invalid={!!formState.errors.password}
                className="pr-10"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted hover:text-ink"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>

        <div className="mt-2 flex items-start gap-2.5">
          <input
            id="acceptedTerms"
            type="checkbox"
            className="mt-1 size-4 rounded border-line text-brand-700 focus:ring-brand-500"
            {...register("acceptedTerms")}
          />
          <label htmlFor="acceptedTerms" className="text-xs leading-relaxed text-muted">
            I accept the{" "}
            <span className="text-ink underline cursor-pointer" title="Terms of Service">
              Terms
            </span>{" "}
            and{" "}
            <span className="text-ink underline cursor-pointer" title="Privacy Policy">
              Privacy Policy
            </span>
            .
          </label>
        </div>
        {formState.errors.acceptedTerms && (
          <p className="-mt-2 text-xs font-medium text-danger">{formState.errors.acceptedTerms.message}</p>
        )}

        <Button type="submit" loading={formState.isSubmitting} className="mt-2 w-full">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-800">
          Sign in
        </Link>
      </p>
    </>
  );
}
