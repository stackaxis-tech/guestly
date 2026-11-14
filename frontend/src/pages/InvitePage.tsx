import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { Button, ErrorNote, Field, Input, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AuthPage } from "./AuthPage";

type Invite = { name: string; email: string; organization: string };

const schema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match." });

function InviteForm() {
  const { token = "" } = useParams();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState("");
  const invite = useQuery({ queryKey: ["invite", token], queryFn: () => api<Invite>(`/invites/${token}`), retry: false });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), mode: "onTouched" });
  const e = form.formState.errors;

  if (invite.isLoading) return <Spinner />;
  if (invite.error) {
    return (
      <>
        <h1 className="font-display text-3xl font-bold tracking-tight">Link not valid</h1>
        <div className="mt-6">
          <ErrorNote message={invite.error.message} />
        </div>
        <p className="mt-6 text-sm text-muted">
          Already set your password?{" "}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">Sign in</Link>
        </p>
      </>
    );
  }

  const inv = invite.data!;
  return (
    <>
      <p className="text-sm font-semibold text-accent-700">{inv.organization}</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Welcome, {inv.name.split(" ")[0]}</h1>
      <p className="mt-2 text-[15px] text-muted">
        Choose a password for <span className="font-medium text-ink">{inv.email}</span>. You'll use it to sign in to Gustlog.
      </p>
      <form
        noValidate
        className="mt-8 flex flex-col gap-4"
        onSubmit={form.handleSubmit(async (v) => {
          setFormError("");
          try {
            await acceptInvite(token, v.password);
            navigate("/", { replace: true });
          } catch (err) {
            if (err instanceof ApiError && err.fields?.password) form.setError("password", { message: err.fields.password });
            else setFormError(err instanceof Error ? err.message : "Couldn't set your password.");
          }
        })}
      >
        {formError && <ErrorNote message={formError} />}
        {/* Hidden username helps password managers save the right account. */}
        <input type="email" value={inv.email} autoComplete="username" readOnly hidden />
        <Field label="New password" error={e.password?.message} hint="At least 8 characters.">
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" invalid={!!e.password} {...form.register("password")} />}
        </Field>
        <Field label="Confirm password" error={e.confirm?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" invalid={!!e.confirm} {...form.register("confirm")} />}
        </Field>
        <Button type="submit" loading={form.formState.isSubmitting} className="mt-2 w-full">
          Set password and continue
        </Button>
      </form>
    </>
  );
}

export function InvitePage() {
  return (
    <AuthPage>
      <InviteForm />
    </AuthPage>
  );
}
