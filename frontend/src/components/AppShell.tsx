import clsx from "clsx";
import { AlertTriangle, BarChart3, BedDouble, CalendarDays, ChevronsUpDown, Check, Clock, Home, LogOut, Settings, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";
import { Logo, LogoMark } from "./brand/Logo";
import { Button, ErrorNote, Spinner } from "./ui";
import { PropertyLogo } from "./PropertyLogo";
import { roleLabel, useAuth } from "../lib/auth";
import { initials } from "../lib/format";
import { useProperty } from "../lib/property";

const allNav: { to: string; label: string; short?: string; icon: typeof Home; end?: boolean; housekeeping: boolean; desktopOnly?: boolean }[] = [
  { to: "/", label: "Today", icon: Home, end: true, housekeeping: true },
  { to: "/rooms", label: "Rooms", icon: BedDouble, housekeeping: true },
  { to: "/guests", label: "Guests", icon: Users, housekeeping: false },
  { to: "/reservations", label: "Reservations", short: "Bookings", icon: CalendarDays, housekeeping: false },
  { to: "/reports", label: "Reports", icon: BarChart3, housekeeping: false, desktopOnly: true },
  { to: "/settings", label: "Settings", icon: Settings, housekeeping: false },
];

function useNav() {
  const { user } = useAuth();
  return user?.role === "housekeeping" ? allNav.filter((n) => n.housekeeping) : allNav;
}

export function AppShell() {
  const { current, isLoading, error, refetch } = useProperty();
  const nav = useNav();
  const tabs = nav.filter((n) => !n.desktopOnly);
  const { pathname } = useLocation();

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col overflow-y-auto border-r border-line bg-paper lg:flex">
        <div className="px-5 pt-5 pb-4">
          <Logo size={30} />
        </div>
        <div className="px-3">
          <PropertySwitcher />
        </div>
        <nav className="mt-4 flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors",
                  isActive ? "bg-teal-50 text-teal-800" : "text-ink-soft hover:bg-sand hover:text-ink",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={clsx("size-[18px]", isActive ? "text-teal-700" : "text-muted")} aria-hidden />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <UserMenu />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 backdrop-blur lg:hidden">
        <LogoMark size={30} />
        <div className="min-w-0 flex-1">
          <PropertySwitcher compact />
        </div>
        <UserMenu compact />
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
        {isLoading ? (
          <Spinner label="Loading your property" />
        ) : error ? (
          <ErrorNote message="We couldn't load your properties." onRetry={refetch} />
        ) : current ? (
          <>
            <BillingBanner />
            <ErrorBoundary resetKey={pathname}>
              <Outlet />
            </ErrorBoundary>
          </>
        ) : (
          <ErrorNote message="No property is linked to your account yet. Ask the owner to give you access." />
        )}
      </main>

      {/* Mobile bottom tabs */}
      {pathname !== "/check-in" && (
      <nav
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        className="fixed inset-x-0 bottom-0 z-20 grid border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Main"
      >
        {tabs.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                "flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-semibold",
                isActive ? "text-teal-700" : "text-muted",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx("rounded-full px-4 py-1 transition-colors", isActive && "bg-teal-50")}>
                  <Icon className="size-5" aria-hidden />
                </span>
                {short ?? label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      )}
    </div>
  );
}

function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function PropertySwitcher({ compact }: { compact?: boolean }) {
  const { properties, current, select } = useProperty();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  if (!current) return null;
  const place = [current.city, current.state].filter(Boolean).join(", ");

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={clsx(
          "flex w-full items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-sand",
          compact ? "px-2 py-1" : "border border-line px-2.5 py-2",
        )}
      >
        <PropertyLogo name={current.name} url={current.logoUrl} size={compact ? 28 : 32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{current.name}</span>
          {place && <span className="block truncate text-xs text-muted">{place}</span>}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 min-w-56 overflow-hidden rounded-lg border border-line bg-paper py-1 shadow-[var(--shadow-pop)]"
        >
          {properties.map((p) => (
            <button
              key={p.id}
              role="option"
              aria-selected={p.id === current.id}
              onClick={() => {
                select(p.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sand"
            >
              <span className="flex min-w-0 items-center gap-2">
                <PropertyLogo name={p.name} url={p.logoUrl} size={22} />
                <span className="truncate">{p.name}</span>
              </span>
              {p.id === current.id && <Check className="size-4 text-teal-700" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({ compact }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account menu"
        className={clsx("flex items-center gap-2.5 rounded-lg text-left hover:bg-sand", compact ? "p-1" : "w-full p-2")}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-marigold-100 text-xs font-bold text-marigold-700">
          {initials(user.name)}
        </span>
        {!compact && (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{user.name}</span>
            <span className="block text-xs text-muted">{roleLabel[user.role]}</span>
          </span>
        )}
      </button>
      {open && (
        <div
          className={clsx(
            "absolute z-30 w-56 rounded-lg border border-line bg-paper p-1 shadow-[var(--shadow-pop)]",
            compact ? "top-full right-0 mt-1" : "bottom-full left-0 mb-1",
          )}
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" icon={<LogOut className="size-4" />} onClick={logout}>
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}

/** Warns hotel staff about their Guestlog plan: trial ending, grace period, or read-only. */
function BillingBanner() {
  const { current } = useProperty();
  const b = current?.billing;
  if (!b) return null;
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

  let tone = "";
  let text = "";
  if (b.state === "expired") {
    tone = "border-danger/30 bg-danger-bg text-danger";
    text = "Your Guestlog plan has expired, so this property is read-only. Contact Guestlog to renew and continue checking guests in.";
  } else if (b.state === "grace") {
    tone = "border-marigold-300 bg-marigold-50 text-marigold-700";
    text = `Your Guestlog plan ended. Renew within ${days(b.graceDaysLeft)} to avoid read-only mode.`;
  } else if (b.state === "trial" && b.daysLeft <= 7) {
    tone = "border-teal-200 bg-teal-50 text-teal-800";
    text = b.daysLeft === 0 ? "Your free trial ends today." : `Your free trial ends in ${days(b.daysLeft)}.`;
  } else if (b.state === "active" && b.daysLeft <= 7) {
    tone = "border-teal-200 bg-teal-50 text-teal-800";
    text = b.daysLeft === 0 ? "Your Guestlog plan renews today." : `Your Guestlog plan is due for renewal in ${days(b.daysLeft)}.`;
  } else {
    return null;
  }
  const Icon = b.state === "expired" || b.state === "grace" ? AlertTriangle : Clock;
  return (
    <div className={clsx("mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", tone)} role="status">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </div>
  );
}
