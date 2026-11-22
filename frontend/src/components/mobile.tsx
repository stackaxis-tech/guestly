/**
 * Mobile-first building blocks: list rows, quick-action tiles, segmented
 * tabs, search, stay cards and a floating action button. They use only the
 * design tokens in index.css, so they match the rest of Gustlog.
 */
import clsx from "clsx";
import { ArrowLeft, ChevronRight, FileText, MessageCircle, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { rupees } from "../lib/format";
import { haptic } from "../lib/native";
import type { StaySummary } from "../lib/stays";

/* ---------- Lists ---------- */

export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">{title}</h2>}
      <ul className="surface divide-y divide-line/70 overflow-hidden">{children}</ul>
    </section>
  );
}

export function ListRow({
  to,
  onClick,
  icon: Icon,
  title,
  subtitle,
  badge,
  tone = "default",
}: {
  to?: string;
  onClick?: () => void;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  badge?: number | string;
  tone?: "default" | "danger";
}) {
  const body = (
    <>
      <span
        className={clsx(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          tone === "danger" ? "bg-danger-bg text-danger" : "bg-sand text-ink-soft",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx("block truncate text-[15px] font-semibold", tone === "danger" && "text-danger")}>{title}</span>
        {subtitle && <span className="block truncate text-[13px] text-muted">{subtitle}</span>}
      </span>
      {badge !== undefined && badge !== 0 && (
        <span className="tabular rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">{badge}</span>
      )}
      {to && <ChevronRight className="size-5 shrink-0 text-muted/70" aria-hidden />}
    </>
  );
  const cls = "pressable flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-sand active:bg-sand";
  return (
    <li>
      {to ? (
        <Link to={to} onClick={onClick} className={cls}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={cls}>
          {body}
        </button>
      )}
    </li>
  );
}

/* ---------- Page headers ---------- */

/** Back arrow + title for pages one level below a list (settings sections). */
export function SubPageHeader({ title, back, actions }: { title: string; back: string; actions?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="mb-5 flex items-center gap-2">
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(back))}
        className="-ml-2 flex size-11 items-center justify-center rounded-full text-ink-soft hover:bg-sand"
        aria-label="Back"
      >
        <ArrowLeft className="size-5" />
      </button>
      <h1 className="min-w-0 flex-1 truncate font-display text-xl font-bold">{title}</h1>
      {actions}
    </header>
  );
}

/* ---------- Quick actions ---------- */

export type QuickAction = { id: string; label: string; icon: LucideIcon; to?: string; onClick?: () => void; badge?: number; primary?: boolean };

export function QuickActions({ items, title = "Quick actions" }: { items: QuickAction[]; title?: string }) {
  return (
    <section className="surface px-2 pt-3.5 pb-2.5">
      <h2 className="mb-2.5 px-2 text-[13px] font-semibold text-muted">{title}</h2>
      <div className="grid grid-cols-4 gap-1">
        {items.map((a) => {
          const tile = (
            <>
              <span
                className={clsx(
                  "relative flex size-12 items-center justify-center rounded-2xl transition-colors",
                  a.primary ? "bg-brand-700 text-white group-hover:bg-brand-800" : "bg-sand text-ink group-hover:bg-line/70",
                )}
              >
                <a.icon className="size-[22px]" strokeWidth={1.9} aria-hidden />
                {!!a.badge && (
                  <span className="tabular absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full border-2 border-paper bg-accent-400 px-1 text-[10px] font-bold text-ink">
                    {a.badge}
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center text-[12px] font-medium text-ink">{a.label}</span>
            </>
          );
          const cls = "pressable group flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 hover:bg-sand";
          return a.to ? (
            <Link key={a.id} to={a.to} className={cls} onClick={() => haptic()}>
              {tile}
            </Link>
          ) : (
            <button key={a.id} type="button" onClick={() => { haptic(); a.onClick?.(); }} className={cls}>
              {tile}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Segmented tabs ---------- */

export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-line/60 p-1" role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => { if (!active) haptic(); onChange(o.value); }}
            className={clsx(
              "flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors",
              active ? "bg-paper text-ink shadow-[0_1px_3px_rgb(36_36_36/0.12)]" : "text-ink-soft hover:text-ink",
            )}
          >
            <span className="truncate">{o.label}</span>
            {o.count !== undefined && (
              <span className={clsx("tabular text-[12px] font-medium", active ? "text-muted" : "text-muted/80")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Search ---------- */

export function SearchBar({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={clsx("surface flex h-12 items-center gap-3 rounded-xl px-4 focus-within:ring-2 focus-within:ring-ink/10", className)}>
      <Search className="size-5 shrink-0 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-muted/70 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} className="rounded-full p-1 text-muted hover:bg-sand" aria-label="Clear search">
          <X className="size-4" />
        </button>
      )}
    </label>
  );
}

/* ---------- Stay card ---------- */

export type StayTone = "in_house" | "due_out" | "overdue" | "checked_out" | "cancelled";

const pill: Record<StayTone, [string, string]> = {
  in_house: ["In-house", "bg-occupied-bg text-occupied"],
  due_out: ["Due out today", "bg-accent-50 text-accent-700"],
  overdue: ["Overdue", "bg-danger-bg text-danger"],
  checked_out: ["Checked out", "bg-maintenance-bg text-maintenance"],
  cancelled: ["Cancelled", "bg-danger-bg text-danger"],
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function stayTone(s: StaySummary, todayIso: string): StayTone {
  if (s.status !== "in_house") return s.status;
  const due = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(s.expectedCheckOutAt));
  return due < todayIso ? "overdue" : due === todayIso ? "due_out" : "in_house";
}

/** A stay as a card: who, which room, status, money and quick actions. */
export function StayCard({ s, tone, onShare }: { s: StaySummary; tone: StayTone; onShare?: () => void }) {
  const [label, cls] = pill[tone];
  const total = s.total ?? 0;
  const balance = s.balance ?? 0;
  const dates =
    s.status === "checked_out" && s.checkedOutAt
      ? `${shortDate(s.checkInAt)} – ${shortDate(s.checkedOutAt)}`
      : `${shortDate(s.checkInAt)} – ${shortDate(s.expectedCheckOutAt)}`;

  return (
    <article className="surface">
      <Link to={`/stays/${s.id}`} className="pressable flex items-start gap-3 px-4 pt-4 pb-3">
        <span className="tabular flex size-12 shrink-0 items-center justify-center rounded-xl bg-sand font-display text-lg font-bold" aria-label={`Room ${s.roomNumber}`}>
          {s.roomNumber}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate text-[15px] font-semibold">{s.guestName}</span>
            <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}>{label}</span>
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">
            {s.roomType}, {dates}
          </span>
        </span>
      </Link>
      {tone !== "cancelled" && (
        <div className="flex items-center gap-2 border-t border-line/70 px-4 py-2.5">
          <div className="grid flex-1 grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-muted">{s.status === "in_house" ? "Bill so far" : "Total"}</p>
              <p className="tabular font-display text-[15px] font-bold">{rupees(total)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted">{balance > 0 ? "To collect" : "Balance"}</p>
              <p className={clsx("tabular font-display text-[15px] font-bold", balance > 0 ? "text-ink" : "text-ready")}>
                {balance > 0 ? rupees(balance) : "Settled"}
              </p>
            </div>
          </div>
          {s.status === "checked_out" && (
            <Link to={`/stays/${s.id}/invoice`} className="pressable flex size-11 items-center justify-center rounded-full text-ink-soft hover:bg-sand" aria-label="Invoice">
              <FileText className="size-5" />
            </Link>
          )}
          {onShare && (
            <button type="button" onClick={onShare} className="pressable flex size-11 items-center justify-center rounded-full text-ink-soft hover:bg-sand" aria-label="Send on WhatsApp">
              <MessageCircle className="size-5" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/* ---------- Floating action button ---------- */

/** Primary action floating above the bottom nav (phones and tablets only). */
/** True while the page is moving down (away from the top); false at the top or when scrolling back up. */
function useScrollingDown(threshold = 8) {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 40) setDown(false);
      else if (Math.abs(y - last) > threshold) setDown(y > last);
      else return;
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return down;
}

/** The screen's main action. Shrinks to its icon while scrolling down so it covers less of the list. */
export function Fab({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  const compact = useScrollingDown();
  return (
    <Link
      to={to}
      onClick={() => haptic("medium")}
      aria-label={label}
      className={clsx(
        "pressable hide-on-keyboard fixed right-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5rem)] z-20 flex h-14 items-center overflow-hidden rounded-full bg-brand-700 font-semibold text-white shadow-[var(--shadow-float)] transition-[padding,background-color] duration-200 ease-out hover:bg-brand-800 active:bg-brand-900 motion-reduce:transition-none lg:hidden",
        compact ? "px-[18px]" : "pr-6 pl-5",
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <span
        className={clsx(
          "grid transition-[grid-template-columns,opacity,margin] duration-200 ease-out motion-reduce:transition-none",
          compact ? "ml-0 grid-cols-[0fr] opacity-0" : "ml-2 grid-cols-[1fr] opacity-100",
        )}
        aria-hidden
      >
        <span className="overflow-hidden whitespace-nowrap">{label}</span>
      </span>
    </Link>
  );
}
