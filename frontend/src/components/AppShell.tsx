import clsx from "clsx";
import { AlertTriangle, BarChart3, BedDouble, CalendarDays, ChevronDown, Check, Clock, Home, LogOut, MapPin, Settings, UserCheck, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";
import { Logo, LogoMark } from "./brand/Logo";
import { Button, ErrorNote, Spinner } from "./ui";
import { PropertyLogo } from "./PropertyLogo";
import { roleLabel, useAuth } from "../lib/auth";
import { initials } from "../lib/format";
import { useProperty } from "../lib/property";

const allNav: { to: string; label: string; short?: string; icon: typeof Home; end?: boolean; housekeeping: boolean; desktopOnly?: boolean; managerOnly?: boolean }[] = [
  { to: "/", label: "Today", icon: Home, end: true, housekeeping: true },
  { to: "/rooms", label: "Rooms", icon: BedDouble, housekeeping: true },
  { to: "/guests", label: "Guests", icon: Users, housekeeping: false },
  { to: "/reservations", label: "Reservations", short: "Bookings", icon: CalendarDays, housekeeping: false },
  { to: "/staff", label: "Staff", short: "Staff", icon: UserCheck, housekeeping: false, managerOnly: true },
  { to: "/reports", label: "Reports", icon: BarChart3, housekeeping: false, managerOnly: true },
];

function useNav() {
  const { user } = useAuth();
  const isManager = user?.role === "owner" || user?.role === "manager";
  if (user?.role === "housekeeping") return allNav.filter((n) => n.housekeeping);
  if (!isManager) return allNav.filter((n) => !n.managerOnly);
  return allNav;
}

export function AppShell() {
  const { current, isLoading, error, refetch } = useProperty();
  const { user } = useAuth();
  const nav = useNav();
  const { pathname } = useLocation();

  return (
    <div className="min-h-dvh">
      {/* Top bar: brand, property switcher, management quick links, account */}
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-16 w-full items-center gap-3 px-4 sm:px-6 lg:h-[72px] lg:px-9">
          <div className="flex shrink-0 items-center lg:flex-1">
            <LogoMark size={30} className="sm:hidden" />
            <Logo size={30} className="max-sm:hidden" />
          </div>
          <div className="min-w-0 flex-1 sm:max-w-64 lg:max-w-60 lg:flex-none">
            <PropertySwitcher />
          </div>
          {/* Direct header links for Owner / Manager */}
          {user && (user.role === "owner" || user.role === "manager") && (
            <div className="hidden items-center gap-2 sm:flex sm:ml-4">
              <NavLink
                to="/staff"
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    isActive ? "bg-brand-50 text-brand-700 border border-brand-200" : "text-muted hover:bg-sand hover:text-ink",
                  )
                }
              >
                <UserCheck className="size-3.5" aria-hidden />
                Staff & Team
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    isActive ? "bg-brand-50 text-brand-700 border border-brand-200" : "text-muted hover:bg-sand hover:text-ink",
                  )
                }
              >
                <Settings className="size-3.5" aria-hidden />
                Settings
              </NavLink>
            </div>
          )}
          <div className="flex shrink-0 items-center justify-end sm:ml-auto lg:ml-0 lg:flex-1">
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-32 sm:px-6 lg:px-10 lg:pt-10">
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

      {/* Floating bottom navigation (all screen sizes) */}
      {pathname !== "/check-in" && (
        <nav
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-[600px] rounded-2xl border border-line bg-paper/95 px-1 shadow-[var(--shadow-float)] backdrop-blur lg:max-w-[680px]"
          aria-label="Main"
        >
          {nav.map(({ to, label, short, icon: Icon, end, desktopOnly }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "relative flex min-w-0 flex-1 flex-col items-center gap-1 pt-3 pb-2.5 text-[11px] transition-colors",
                  isActive ? "font-bold text-brand-700" : "font-medium text-muted hover:text-ink",
                  desktopOnly && "hidden lg:flex",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-brand-700" aria-hidden />}
                  <Icon className="size-5" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
                  <span className="max-w-full truncate">
                    <span className="sm:hidden">{short ?? label}</span>
                    <span className="max-sm:hidden">{label}</span>
                  </span>
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

function PropertySwitcher() {
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
        className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-paper px-2 py-1.5 text-left transition-colors hover:border-line-strong"
      >
        <PropertyLogo name={current.name} url={current.logoUrl} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{current.name}</span>
          {place && (
            <span className="flex items-center gap-1 truncate text-xs text-muted">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{place}</span>
            </span>
          )}
        </span>
        <ChevronDown className={clsx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
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
              {p.id === current.id && <Check className="size-4 text-brand-700" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
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
        className="flex items-center gap-2.5 rounded-full p-0.5 text-left transition-colors hover:bg-sand lg:pr-3"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-700">
          {initials(user.name)}
        </span>
        <span className="min-w-0 max-lg:hidden">
          <span className="block max-w-40 truncate text-sm font-semibold">{user.name}</span>
          <span className="block text-xs text-muted">{roleLabel[user.role]}</span>
        </span>
      </button>
      {open && (
        <div
          className="absolute top-full right-0 z-30 mt-2 w-56 rounded-xl border border-line bg-paper p-1 shadow-[var(--shadow-pop)]"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-sand"
          >
            <UserCheck className="size-4" aria-hidden />
            Staff Profile
          </Link>
          {(user.role === "owner" || user.role === "manager") && (
            <>
              <Link
                to="/staff"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-sand text-brand-700"
              >
                <UserCheck className="size-4 text-brand-700" aria-hidden />
                Staff & Team Logins
              </Link>
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-sand"
              >
                <Settings className="size-4" aria-hidden />
                Settings
              </Link>
            </>
          )}
          <Button variant="ghost" size="sm" className="w-full justify-start" icon={<LogOut className="size-4" />} onClick={logout}>
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}

/** Warns hotel staff about their Gustlog plan: trial ending, grace period, or read-only. */
function BillingBanner() {
  const { current } = useProperty();
  const b = current?.billing;
  if (!b) return null;
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

  let tone = "";
  let text = "";
  let showSubscribe = false;

  const usage = current?.entryUsage;
  const isTrial = current?.subscription?.isTrial;

  if (isTrial && usage && usage.exceeded) {
    tone = "border-danger/30 bg-danger-bg text-danger";
    text = `Free tier limit reached (${usage.total}/${usage.limit} entries used across rooms, check-ins & reservations). Move to a subscription plan to continue.`;
    showSubscribe = true;
  } else if (b.state === "expired") {
    tone = "border-danger/30 bg-danger-bg text-danger";
    text = "Your free trial / Gustlog plan has expired. Subscribe to continue checking guests in.";
    showSubscribe = true;
  } else if (b.state === "grace") {
    tone = "border-accent-300 bg-accent-50 text-accent-700";
    text = `Your Gustlog plan ended. Renew within ${days(b.graceDaysLeft)} to avoid read-only mode.`;
    showSubscribe = true;
  } else if (b.state === "trial") {
    if (b.daysLeft <= 3) {
      tone = "border-danger/30 bg-danger-bg text-danger";
    } else if (b.daysLeft <= 7) {
      tone = "border-accent-300 bg-accent-50 text-accent-700";
    } else {
      tone = "border-brand-200 bg-brand-50 text-brand-800";
    }
    text = b.daysLeft === 0 ? "Free trial: ends today." : `Free trial: ${days(b.daysLeft)} left.`;
    showSubscribe = true;
  } else if (b.state === "active" && b.daysLeft <= 7) {
    tone = "border-brand-200 bg-brand-50 text-brand-800";
    text = b.daysLeft === 0 ? "Your Gustlog plan renews today." : `Your Gustlog plan is due for renewal in ${days(b.daysLeft)}.`;
    showSubscribe = true;
  } else {
    return null;
  }

  const Icon = b.state === "expired" || (b.state === "trial" && b.daysLeft <= 3) || b.state === "grace" ? AlertTriangle : Clock;
  return (
    <div className={clsx("mb-6 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm", tone)} role="status">
      <div className="flex items-center gap-3">
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="font-medium">{text}</span>
      </div>
      {showSubscribe && (
        <Link
          to="/billing"
          className="ml-auto shrink-0 rounded-lg bg-ink px-3 py-1 text-xs font-semibold text-white transition hover:bg-ink/90"
        >
          Subscribe
        </Link>
      )}
    </div>
  );
}
