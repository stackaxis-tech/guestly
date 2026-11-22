import clsx from "clsx";
import { AlertTriangle, Bell, ChevronDown, Check, Clock, LogOut, MapPin, MoreHorizontal, Settings, UserCheck } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, Link } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";
import { Logo } from "./brand/Logo";
import { Button, ErrorNote, Sheet, Spinner } from "./ui";
import { ListGroup, ListRow } from "./mobile";
import { PropertyLogo } from "./PropertyLogo";
import { RoleAvatar } from "./RoleAvatar";
import { useAlerts } from "../lib/alerts";
import { roleLabel, useAuth } from "../lib/auth";
import { menuFor } from "../lib/menu";
import { haptic } from "../lib/native";
import { useCurrentProperty, useProperty } from "../lib/property";

/** Lets any page (e.g. Home's "All" tile) open the More sheet. */
const MoreContext = createContext<() => void>(() => {});
export const useOpenMore = () => useContext(MoreContext);

/** Full-screen pages with their own back arrow: no bottom nav. */
const hideNav = (path: string) => path === "/check-in" || /^\/settings\/[^/]+/.test(path);

export function AppShell() {
  const { current, isLoading, error, refetch } = useProperty();
  const { user } = useAuth();
  const nav = menuFor(user?.role, "nav");
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);
  const scrolled = useScrolled();

  return (
    <MoreContext.Provider value={() => setMoreOpen(true)}>
    <div className="min-h-dvh">
      {/* Top bar: brand, property switcher, management quick links, account */}
      {/* Flat at the top of the page; lifts with a soft shadow once content scrolls under it. */}
      <header
        className={clsx(
          "sticky top-0 z-20 bg-paper pt-[env(safe-area-inset-top)] transition-shadow duration-200",
          scrolled ? "shadow-[0_1px_0_rgb(36_36_36/0.06),0_6px_16px_-10px_rgb(36_36_36/0.25)]" : "shadow-[0_1px_0_rgb(36_36_36/0.06)]",
        )}
      >
        <div className="mx-auto flex h-14 w-full items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-6 lg:h-[72px] lg:px-9">
          {/* On phones the hotel is the brand; Gustlog shows on wider screens, the login and the app icon. */}
          <div className="flex shrink-0 items-center max-sm:hidden lg:flex-1">
            <Logo size={30} />
          </div>
          <div className="min-w-0 flex-1 sm:max-w-64 lg:max-w-60 lg:flex-none">
            <PropertySwitcher />
          </div>
          {/* Settings link for owner / manager on wider screens (Staff & team lives inside Settings) */}
          {user && (user.role === "owner" || user.role === "manager") && (
            <div className="hidden items-center gap-2 sm:flex sm:ml-4">
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
          <div className="flex shrink-0 items-center justify-end gap-1 sm:ml-auto lg:ml-0 lg:flex-1">
            {current && <AlertsBell />}
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

      {/* Floating bottom navigation (all screen sizes). On phones the
          manager-only tabs move into the More sheet so the bar stays at five. */}
      {!hideNav(pathname) && (
        /* Content fades out behind the floating nav instead of showing through the gap around it. */
        <div
          className="hide-on-keyboard pointer-events-none fixed inset-x-0 bottom-0 z-10 h-[calc(max(0.75rem,env(safe-area-inset-bottom))+6rem)] bg-linear-to-t from-ivory from-45% to-transparent"
          aria-hidden
        />
      )}
      {!hideNav(pathname) && (
        <nav
          className="hide-on-keyboard fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-[600px] rounded-2xl border border-line bg-paper px-1 shadow-[var(--shadow-float)] lg:max-w-[680px]"
          aria-label="Main"
        >
          {nav.map(({ id, to, label, short, icon: Icon, end, nav: where }) => (
            <NavLink
              key={id}
              to={to}
              end={end}
              onClick={() => haptic()}
              className={({ isActive }) =>
                clsx(
                  "pressable relative flex min-w-0 flex-1 flex-col items-center gap-1 pt-3 pb-2.5 text-[11px] transition-colors",
                  isActive ? "font-bold text-brand-700" : "font-medium text-muted hover:text-ink",
                  where === "desktop" && "hidden lg:flex",
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
          <button
            type="button"
            onClick={() => {
              haptic();
              setMoreOpen(true);
            }}
            className={clsx(
              "pressable relative flex min-w-0 flex-1 flex-col items-center gap-1 pt-3 pb-2.5 text-[11px] transition-colors lg:hidden",
              moreOpen ? "font-bold text-brand-700" : "font-medium text-muted hover:text-ink",
            )}
          >
            <MoreHorizontal className="size-5" strokeWidth={1.8} aria-hidden />
            More
          </button>
        </nav>
      )}
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
    </MoreContext.Provider>
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
  // With a single hotel there is nothing to switch to, so the name is just a label.
  const switchable = properties.length > 1;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => switchable && setOpen((o) => !o)}
        disabled={!switchable}
        aria-expanded={switchable ? open : undefined}
        aria-haspopup={switchable ? "listbox" : undefined}
        className={clsx(
          "flex max-w-full items-center gap-2.5 rounded-xl px-1 py-1 text-left transition-colors disabled:cursor-default",
          switchable && "pressable hover:bg-sand",
        )}
      >
        <PropertyLogo name={current.name} url={current.logoUrl} size={34} />
        <span className="min-w-0">
          <span className="block truncate font-display text-[16px] leading-tight font-bold tracking-[-0.01em]">{current.name}</span>
          {place && (
            <span className="flex items-center gap-1 truncate text-xs text-muted max-lg:hidden">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{place}</span>
            </span>
          )}
        </span>
        {switchable && <ChevronDown className={clsx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />}
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

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth();
  const items = menuFor(user?.role, "more");
  if (!user) return null;
  return (
    <Sheet open={open} onClose={onClose} title="More" description={`${user.name} · ${roleLabel[user.role]}`}>
      <div className="flex flex-col gap-4">
        {items.length > 0 && (
          <ListGroup>
            {items.map((m) => (
              <ListRow key={m.id} to={m.to} onClick={onClose} icon={m.icon} title={m.label} />
            ))}
          </ListGroup>
        )}
        <ListGroup>
          <ListRow onClick={logout} icon={LogOut} title="Sign out" tone="danger" />
        </ListGroup>
      </div>
    </Sheet>
  );
}

/** The bell: things that need attention today, worked out on the device. */
function AlertsBell() {
  const property = useCurrentProperty();
  const { user } = useAuth();
  const alerts = useAlerts(property, user?.role);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const tone = { info: "bg-brand-50 text-brand-700", warn: "bg-accent-50 text-accent-700", danger: "bg-danger-bg text-danger" };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex size-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand"
        aria-label={alerts.length ? `${alerts.length} alerts` : "Alerts"}
      >
        <Bell className="size-5" aria-hidden />
        {alerts.length > 0 && (
          <span className="tabular absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-bold text-white">
            {alerts.length}
          </span>
        )}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Needs attention" description={property.name}>
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-ready-bg text-ready">
              <Check className="size-6" aria-hidden />
            </span>
            <p className="font-semibold">All clear</p>
            <p className="mt-1 text-sm text-muted">Nothing needs your attention right now.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.map((a) => (
              <li key={a.id}>
                <Link to={a.to} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-xl border border-line p-3.5 hover:bg-sand">
                  <span className={clsx("flex size-9 shrink-0 items-center justify-center rounded-lg", tone[a.tone])}>
                    <a.icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">{a.title}</span>
                    <span className="block text-[13px] text-muted">{a.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
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
        <RoleAvatar role={user.role} size="sm" quiet />
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
  const { user } = useAuth();
  // Only owners and managers can open /billing; other staff get the facts, not a dead button.
  const manager = user?.role === "owner" || user?.role === "manager";
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
    text = `Free limit reached: ${usage.total} of ${usage.limit} entries used. Subscribe to keep adding rooms, check-ins and bookings.`;
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
    <div className="surface mb-5 flex items-center gap-3 px-3.5 py-3 sm:mb-6 sm:px-4" role="status">
      <span className={clsx("flex size-8 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink-soft sm:text-sm">{text}</p>
      {showSubscribe && manager && (
        <Link to="/billing" className="pressable shrink-0 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white transition hover:bg-ink/90">
          See plans
        </Link>
      )}
    </div>
  );
}

/** True once the page has scrolled away from the top. */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}
