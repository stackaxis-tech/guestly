import { AlertTriangle, Clock, Download, ShieldAlert } from "lucide-react";
import { useProperty } from "../lib/property";
import { useAuth } from "../lib/auth";
import { Button, Card, PageHeader } from "../components/ui";

export function BillingPage() {
  const { current } = useProperty();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  const s = current?.subscription;
  const b = current?.billing;
  const usage = current?.entryUsage;

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-50 text-accent-700">
          <ShieldAlert className="size-6" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold">Billing is restricted to account owners</h1>
        <p className="mt-2 text-sm text-muted">
          Your hotel's subscription is managed by the account owner. Please contact your property owner to manage or
          renew your Gustlog plan.
        </p>
      </div>
    );
  }

  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  const planName = s?.plan === "annual" ? "Annual Plan" : s?.plan === "monthly" ? "Monthly Plan" : "Custom Plan";
  const ends = s ? new Date(s.endsOn.slice(0, 10) + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Subscription & Billing"
        description="Manage your Gustlog subscription, plan details, and data export."
      />

      {/* Status banner */}
      {b?.state === "expired" && (
        <div className="rounded-xl border border-danger/30 bg-danger-bg p-5 text-danger" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-base">Your free trial has ended</h3>
              <p className="mt-1 text-sm leading-relaxed opacity-90">
                Subscribe to continue. Your data is safe and full access will be restored as soon as you subscribe.
              </p>
            </div>
          </div>
        </div>
      )}

      {b?.state === "trial" && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 text-brand-900" role="status">
          <div className="flex items-start gap-3">
            <Clock className="size-5 shrink-0 mt-0.5 text-brand-700" />
            <div>
              <h3 className="font-semibold text-base">
                {b.daysLeft === 0 ? "Your free trial ends today" : `Trial version: ${days(b.daysLeft)} left`}
              </h3>
              <p className="mt-1 text-sm text-brand-800">
                You have full access to all Gustlog features during your 30-day trial period
                {usage ? ` (${usage.total} of ${usage.limit} free entries used across rooms, check-ins, and reservations).` : "."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Plan Card */}
      <Card>
        <div className="border-b border-line px-6 py-4">
          <h2 className="font-display font-semibold text-lg">Current Plan</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-muted uppercase tracking-wider">Plan</p>
              <p className="mt-1 font-display text-xl font-bold">{planName}</p>
              <p className="text-xs text-muted">₹899 / month</p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider">Status</p>
              <p className="mt-1 font-semibold capitalize">
                {b?.state === "trial" ? (
                  <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                    Free Trial
                  </span>
                ) : b?.state === "active" ? (
                  <span className="inline-flex items-center rounded-full bg-ready-bg px-2.5 py-0.5 text-xs font-semibold text-ready">
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-semibold text-danger">
                    Expired
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider">
                {b?.state === "trial" ? "Trial Ends" : "Renews On"}
              </p>
              <p className="mt-1 font-semibold">{ends}</p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-line pt-6">
            <a
              href="https://wa.me/919999999999?text=Hi%20Gustlog%2C%20I%20would%20like%20to%20subscribe%20to%20continue%20using%20my%20account."
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 transition"
            >
              Subscribe now
            </a>
            <span className="text-xs text-muted">
              UPI, NetBanking, and credit/debit cards accepted.
            </span>
          </div>
        </div>
      </Card>

      {/* Export Data Card */}
      <Card>
        <div className="border-b border-line px-6 py-4">
          <h2 className="font-display font-semibold text-lg">Export your data</h2>
        </div>
        <div className="p-6">
          <p className="text-sm text-muted">
            You can export and download your complete hotel data (guests, stays, room list, and invoices) at any time,
            including when your trial or subscription has ended.
          </p>
          <div className="mt-4">
            <Button
              variant="secondary"
              icon={<Download className="size-4" />}
              onClick={() => {
                alert("Export initiated. Your data summary is being prepared for download.");
              }}
            >
              Export my data
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
