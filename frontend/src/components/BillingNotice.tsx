import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { canManage, useAuth } from "../lib/auth";

/**
 * Shown instead of a form when the property can't take new entries, so staff
 * learn it before typing a guest's details, not after. Owners and managers
 * get a way to subscribe; other staff are told who can.
 */
export function BlockedNotice({ title, body }: { title: string; body: string }) {
  const { user } = useAuth();
  const manager = canManage(user?.role);
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-8 text-center">
      <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-danger-bg text-danger">
        <Lock className="size-5" aria-hidden />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      {manager ? (
        <Link to="/billing" className="pressable mt-5 inline-flex h-11 items-center rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">
          See plans
        </Link>
      ) : (
        <p className="mx-auto mt-4 max-w-sm text-sm font-medium text-ink-soft">Ask the owner or manager to renew the plan.</p>
      )}
    </div>
  );
}
