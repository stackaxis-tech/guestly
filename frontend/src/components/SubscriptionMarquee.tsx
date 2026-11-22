import { Sparkles } from "lucide-react";
import { useProperty } from "../lib/property";

export function SubscriptionMarquee() {
  const { current } = useProperty();
  const isTrial = current?.subscription?.isTrial ?? true;

  // Banner applies to accounts on the free/trial tier
  if (!isTrial) return null;

  const text =
    "The first 9 entries (rooms, check-ins, and reservations) are free. From the 10th entry onwards, your account requires a subscription.";

  return (
    <div
      className="relative mb-6 overflow-hidden rounded-xl border border-brand-200 bg-brand-50/90 py-2.5 shadow-xs"
      role="region"
      aria-label="Subscription Announcement"
    >
      <div className="flex w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_3%,black_97%,transparent)]">
        <div className="animate-marquee flex items-center gap-8 whitespace-nowrap text-xs font-semibold text-brand-900 sm:text-sm">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Sparkles className="size-4 shrink-0 text-brand-700 animate-pulse" aria-hidden />
              <span>{text}</span>
              <span className="ml-4 font-bold text-brand-300">✦</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
