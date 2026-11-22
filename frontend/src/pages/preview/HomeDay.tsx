/**
 * Concept B, "The day": one dark card says how the day stands (money to
 * collect, arrivals, departures), then the day's work in the order it happens.
 */
import clsx from "clsx";
import { LogIn } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Fab } from "../../components/mobile";
import { useAuth } from "../../lib/auth";
import { rupees } from "../../lib/format";
import { dayLabel } from "../../lib/reservations";
import type { StaySummary } from "../../lib/stays";
import { istDate, useToday } from "../../lib/today";

const longDate = () => new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

export function HomeDay() {
  const { user } = useAuth();
  const t = useToday(user?.role);
  const others = t.inHouse.filter((s) => !t.leaving.includes(s));

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-2xl bg-ink px-5 pt-5 pb-5 text-white shadow-[var(--shadow-float)]">
        {/* the red "welcome light" from the logo */}
        <span className="absolute top-5 right-5 size-2.5 rounded-full bg-brand-500 shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-brand-500)_22%,transparent)]" aria-hidden />
        <p className="text-sm text-white/60">{longDate()}</p>
        <p className="mt-5 text-[13px] text-white/60">To collect from guests in-house</p>
        <p className="tabular mt-1 font-display text-[40px] leading-none font-bold tracking-tight">{rupees(t.toCollect)}</p>
        <div className="mt-6 grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
          <Figure n={t.arrivals.length} label="arriving" />
          <Figure n={t.leaving.length} label="leaving" warn={t.overdue.length > 0} />
          <Figure n={`${t.occupancy}%`} label="occupied" />
        </div>
      </section>

      {t.overdue.length > 0 && (
        <Group title="Past checkout">
          {t.overdue.map((s) => (
            <StayLine key={s.id} s={s} note={`Was due ${dayLabel(istDate(s.expectedCheckOutAt))}`} tone="danger" action="Check out" />
          ))}
        </Group>
      )}

      <Group title="Arriving today" empty="No bookings due today.">
        {t.arrivals.map((r) => (
          <Line
            key={r.id}
            room={r.roomNumber}
            name={r.guestName}
            note={`${r.roomType}, until ${dayLabel(r.checkOut)}${r.advanceAmount ? `, ${rupees(r.advanceAmount)} paid` : ""}`}
            action={
              <Link to={`/check-in?reservation=${r.id}`} className="pressable rounded-lg bg-brand-700 px-3.5 py-2 text-[13px] font-semibold text-white">
                Check in
              </Link>
            }
          />
        ))}
      </Group>

      {t.leaving.length > t.overdue.length && (
        <Group title="Leaving today">
          {t.leaving
            .filter((s) => !t.overdue.includes(s))
            .map((s) => (
              <StayLine key={s.id} s={s} note="Due out today" action="Check out" />
            ))}
        </Group>
      )}

      <Group title={`In-house (${others.length})`} empty="No other guests in-house.">
        {others.map((s) => (
          <StayLine key={s.id} s={s} note={`Until ${dayLabel(istDate(s.expectedCheckOutAt))}`} />
        ))}
      </Group>

      <div className="h-16" aria-hidden />
      <Fab to="/check-in" icon={LogIn} label="Check in" />
    </div>
  );
}

function Figure({ n, label, warn }: { n: number | string; label: string; warn?: boolean }) {
  return (
    <div>
      <p className={clsx("tabular font-display text-[22px] leading-none font-bold", warn && "text-brand-300")}>{n}</p>
      <p className="mt-1 text-[12px] text-white/60">{label}</p>
    </div>
  );
}

function Group({ title, empty, children }: { title: string; empty?: string; children: ReactNode[] }) {
  return (
    <section>
      <h2 className="mb-2 px-1 font-display text-[15px] font-bold">{title}</h2>
      {children.length === 0 ? (
        <p className="surface px-4 py-5 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="surface divide-y divide-line/70 overflow-hidden">{children}</ul>
      )}
    </section>
  );
}

function StayLine({ s, note, tone, action }: { s: StaySummary; note: string; tone?: "danger"; action?: string }) {
  return (
    <Line
      room={s.roomNumber}
      name={s.guestName}
      note={note}
      tone={tone}
      to={`/stays/${s.id}`}
      action={
        <span className="text-right">
          <span className="tabular block text-[14px] font-semibold">{s.balance > 0 ? rupees(s.balance) : "Settled"}</span>
          <span className="block text-[11px] text-muted">{action ?? (s.balance > 0 ? "to collect" : "")}</span>
        </span>
      }
    />
  );
}

function Line({ room, name, note, action, tone, to }: { room: string; name: string; note: string; action: ReactNode; tone?: "danger"; to?: string }) {
  const body = (
    <>
      <span className="tabular w-11 shrink-0 font-display text-[17px] font-bold">{room}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{name}</span>
        <span className={clsx("block truncate text-[13px]", tone === "danger" ? "text-danger" : "text-muted")}>{note}</span>
      </span>
      {action}
    </>
  );
  const cls = "flex min-h-16 items-center gap-3 px-4 py-3";
  return <li>{to ? <Link to={to} className={clsx("pressable hover:bg-sand", cls)}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}
