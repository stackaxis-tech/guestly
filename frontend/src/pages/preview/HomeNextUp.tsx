/**
 * Concept C, "Next up": the desk's work as a queue. The most urgent task is
 * a large card with its one action; everything after it waits below.
 */
import clsx from "clsx";
import { BedDouble, CalendarCheck, Check, LogIn, LogOut, Wallet, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Fab } from "../../components/mobile";
import { useAuth } from "../../lib/auth";
import { rupees } from "../../lib/format";
import { dayLabel } from "../../lib/reservations";
import { istDate, useToday } from "../../lib/today";

type Task = { id: string; icon: LucideIcon; kind: string; title: string; detail: string; to: string; cta: string; urgent?: boolean };

export function HomeNextUp() {
  const { user } = useAuth();
  const t = useToday(user?.role);
  const desk = user?.role !== "housekeeping";
  const cleaning = t.rooms.filter((r) => r.status === "cleaning");

  const tasks: Task[] = [
    ...t.overdue.map((s) => ({
      id: s.id, icon: LogOut, kind: "Past checkout", urgent: true, title: s.guestName,
      detail: `Room ${s.roomNumber}, was due ${dayLabel(istDate(s.expectedCheckOutAt))}${s.balance > 0 ? `. ${rupees(s.balance)} to collect.` : "."}`,
      to: `/stays/${s.id}`, cta: "Check out",
    })),
    ...t.arrivals.map((r) => ({
      id: r.id, icon: CalendarCheck, kind: "Arriving today", title: r.guestName,
      detail: `Room ${r.roomNumber}, ${r.roomType}, until ${dayLabel(r.checkOut)}${r.advanceAmount ? `. ${rupees(r.advanceAmount)} already paid.` : "."}`,
      to: `/check-in?reservation=${r.id}`, cta: "Check in",
    })),
    ...t.leaving.filter((s) => !t.overdue.includes(s)).map((s) => ({
      id: s.id, icon: LogOut, kind: "Leaving today", title: s.guestName,
      detail: `Room ${s.roomNumber}${s.balance > 0 ? `. ${rupees(s.balance)} to collect.` : ". Bill settled."}`,
      to: `/stays/${s.id}`, cta: "Check out",
    })),
    ...(cleaning.length ? [{
      id: "clean", icon: BedDouble, kind: "Housekeeping", title: `${cleaning.length} ${cleaning.length === 1 ? "room needs" : "rooms need"} cleaning`,
      detail: `Rooms ${cleaning.map((r) => r.number).join(", ")}`, to: "/rooms", cta: "Open rooms",
    }] : []),
  ].filter((task) => desk || task.id === "clean");

  const [first, ...rest] = tasks;
  const ready = t.rooms.filter((r) => r.status === "ready").length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}</p>
          <h1 className="mt-1 font-display text-[26px] leading-tight font-bold">{tasks.length ? `${tasks.length} things to do` : "All caught up"}</h1>
        </div>
        <Link to="/rooms" className="pressable surface shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold">
          <span className="tabular">{ready}</span> rooms free
        </Link>
      </header>

      {first ? (
        <Link to={first.to} className={clsx("pressable surface block overflow-hidden", first.urgent && "ring-1 ring-danger/25")}>
          <div className="px-5 pt-5 pb-4">
            <p className={clsx("flex items-center gap-2 text-[13px] font-semibold", first.urgent ? "text-danger" : "text-brand-700")}>
              <first.icon className="size-4" aria-hidden />
              {first.kind}
            </p>
            <p className="mt-3 font-display text-[26px] leading-tight font-bold">{first.title}</p>
            <p className="mt-1.5 text-[15px] text-ink-soft">{first.detail}</p>
          </div>
          <div className="flex h-14 items-center justify-center bg-brand-700 text-[15px] font-semibold text-white">{first.cta}</div>
        </Link>
      ) : (
        <div className="surface flex flex-col items-center px-6 py-10 text-center">
          <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-ready-bg text-ready">
            <Check className="size-6" aria-hidden />
          </span>
          <p className="font-semibold">Nothing waiting</p>
          <p className="mt-1 text-sm text-muted">New arrivals and checkouts will appear here.</p>
        </div>
      )}

      {rest.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 font-display text-[15px] font-bold">After that</h2>
          <ul className="surface divide-y divide-line/70 overflow-hidden">
            {rest.map((task) => (
              <li key={task.id}>
                <Link to={task.to} className="pressable flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-sand">
                  <span className={clsx("flex size-10 shrink-0 items-center justify-center rounded-xl", task.urgent ? "bg-danger-bg text-danger" : "bg-sand text-ink")}>
                    <task.icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{task.title}</span>
                    <span className="block truncate text-[13px] text-muted">{task.kind} · {task.detail}</span>
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold text-brand-700">{task.cta}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {desk && t.inHouse.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-baseline justify-between px-1 font-display text-[15px] font-bold">
            In-house
            <span className="flex items-center gap-1 font-sans text-[13px] font-medium text-muted">
              <Wallet className="size-3.5" aria-hidden />
              {rupees(t.toCollect)} to collect
            </span>
          </h2>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {t.inHouse.map((s) => (
              <Link key={s.id} to={`/stays/${s.id}`} className="pressable surface w-40 shrink-0 snap-start px-4 py-3.5">
                <p className="tabular font-display text-lg leading-none font-bold">{s.roomNumber}</p>
                <p className="mt-2 truncate text-[14px] font-semibold">{s.guestName}</p>
                <p className="tabular mt-0.5 text-[12px] text-muted">{s.balance > 0 ? `${rupees(s.balance)} due` : "Settled"}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="h-16" aria-hidden />
      {desk && <Fab to="/check-in" icon={LogIn} label="Check in" />}
    </div>
  );
}
