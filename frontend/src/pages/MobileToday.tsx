/**
 * Home on phones and tablets (below lg): room status, role-based quick
 * actions, and today's guests as cards in three tabs with search. Desktop
 * keeps the grid layout in TodayPage.
 */
import clsx from "clsx";
import { CalendarCheck, LayoutGrid, LogIn, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useOpenMore } from "../components/AppShell";
import { Fab, QuickActions, SearchBar, SegmentedTabs, StayCard, stayTone, type QuickAction } from "../components/mobile";
import { EmptyState, Spinner } from "../components/ui";
import { WhatsAppSend } from "../components/WhatsAppSend";
import { useAuth } from "../lib/auth";
import { rupees, todayLabel } from "../lib/format";
import { quickActionsFor, type BadgeContext } from "../lib/menu";
import { useCurrentProperty } from "../lib/property";
import { addDays, dayLabel, hotelToday, useReservations, type Reservation } from "../lib/reservations";
import { statusMeta, useRooms, type RoomStatus } from "../lib/rooms";
import { useStays, type StaySummary } from "../lib/stays";

type Tab = "in_house" | "arrivals" | "departures";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

const matches = (needle: string, ...fields: string[]) => !needle || fields.some((f) => f.toLowerCase().includes(needle));

export function MobileToday() {
  const { user } = useAuth();
  const property = useCurrentProperty();
  const openMore = useOpenMore();
  const desk = user?.role !== "housekeeping";
  const todayIso = hotelToday();

  const rooms = useRooms(property.id);
  const inHouse = useStays(property.id, "in_house", desk);
  const session = useStays(property.id, "today_session", desk);
  const bookings = useReservations(property.id, addDays(todayIso, -14), addDays(todayIso, 1), desk);

  const [tab, setTab] = useState<Tab>("in_house");
  const [q, setQ] = useState("");
  const [share, setShare] = useState<StaySummary | null>(null);
  const needle = q.trim().toLowerCase();

  const s = rooms.data?.summary;
  const arrivals = (bookings.data ?? []).filter((r) => r.status === "booked" && r.checkIn <= todayIso && r.checkOut > todayIso);
  const lists = useMemo(() => {
    const house = inHouse.data ?? [];
    const due = house.filter((x) => stayTone(x, todayIso) === "due_out");
    const done = (session.data ?? []).filter((x) => x.status !== "in_house");
    return { house, departures: [...due, ...done] };
  }, [inHouse.data, session.data, todayIso]);

  const badges: BadgeContext = { cleaning: s?.cleaning ?? 0, arrivals: arrivals.length, dueOut: lists.departures.length };
  const { shown, overflow } = quickActionsFor(user?.role);
  const actions: QuickAction[] = shown.map((m) => ({ id: m.id, label: m.label, icon: m.icon, to: m.to, primary: m.primary, badge: m.badge?.(badges) }));
  if (overflow) actions.push({ id: "all", label: "All", icon: LayoutGrid, onClick: openMore });

  const filteredStays = (tab === "in_house" ? lists.house : lists.departures).filter((x) => matches(needle, x.guestName, x.guestPhone, x.roomNumber));
  const filteredArrivals = arrivals.filter((r) => matches(needle, r.guestName, r.guestPhone, r.roomNumber));
  const loading = tab === "arrivals" ? bookings.isLoading : inHouse.isLoading || (tab === "departures" && session.isLoading);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-[22px] leading-tight font-bold">
          {greeting()}, {user?.name.split(" ")[0]}
        </h1>
        <p className="mt-0.5 text-sm text-muted">{todayLabel()}</p>
      </div>

      {/* Room status strip */}
      <Link to="/rooms" className="grid grid-cols-4 overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper">
        {(["ready", "occupied", "cleaning", "maintenance"] as RoomStatus[]).map((k, i) => (
          <span key={k} className={clsx("flex flex-col items-center px-1 py-3", i > 0 && "border-l border-line")}>
            <span className="tabular font-display text-xl font-bold">{s ? s[k] : "–"}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
              <span className={clsx("size-1.5 rounded-full", statusMeta[k].bar)} aria-hidden />
              {k === "ready" ? "Ready" : statusMeta[k].label}
            </span>
          </span>
        ))}
      </Link>

      <QuickActions items={actions} />

      {!desk ? (
        s && s.cleaning > 0 ? (
          <Link to="/rooms" className="flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-700">
            <Sparkles className="size-4 shrink-0" aria-hidden />
            <span className="font-semibold">
              {s.cleaning} {s.cleaning === 1 ? "room needs" : "rooms need"} cleaning
            </span>
          </Link>
        ) : null
      ) : (
        <>
          <SegmentedTabs
            value={tab}
            onChange={setTab}
            options={[
              { value: "in_house", label: "In-house", count: lists.house.length },
              { value: "arrivals", label: "Arrivals", count: arrivals.length },
              { value: "departures", label: "Leaving", count: lists.departures.length },
            ]}
          />
          <SearchBar value={q} onChange={setQ} placeholder="Search guest, phone or room" />

          {loading ? (
            <Spinner />
          ) : tab === "arrivals" ? (
            filteredArrivals.length === 0 ? (
              <Empty tab={tab} searching={!!needle} />
            ) : (
              <div className="flex flex-col gap-3">
                {filteredArrivals.map((r) => (
                  <ArrivalCard key={r.id} r={r} todayIso={todayIso} />
                ))}
              </div>
            )
          ) : filteredStays.length === 0 ? (
            <Empty tab={tab} searching={!!needle} />
          ) : (
            <div className="flex flex-col gap-3">
              {filteredStays.map((x) => (
                <StayCard key={x.id} s={x} tone={stayTone(x, todayIso)} onShare={x.status === "cancelled" ? undefined : () => setShare(x)} />
              ))}
            </div>
          )}

          {/* Room for the floating button above the nav */}
          <div className="h-16" aria-hidden />
          <Fab to="/check-in" icon={LogIn} label="Check in" />
        </>
      )}

      {share && (
        <WhatsAppSend
          propertyId={property.id}
          stayId={share.id}
          kind={share.status === "checked_out" ? "bill" : "welcome"}
          open
          onClose={() => setShare(null)}
        />
      )}
    </div>
  );
}

function ArrivalCard({ r, todayIso }: { r: Reservation; todayIso: string }) {
  const late = r.checkIn < todayIso;
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-paper">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span className="tabular flex size-12 shrink-0 flex-col items-center justify-center rounded-xl border border-line bg-sand leading-none">
          <span className="text-[9px] font-semibold tracking-wider text-muted uppercase">Room</span>
          <span className="mt-0.5 font-display text-base font-bold">{r.roomNumber}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate text-[15px] font-semibold">{r.guestName}</span>
            <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", late ? "bg-accent-50 text-accent-700" : "bg-brand-50 text-brand-700")}>
              {late ? "Late arrival" : "Arriving"}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">
            Until {dayLabel(r.checkOut)} · {r.roomType}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
        <div className="flex-1">
          <p className="text-[11px] text-muted">Advance paid</p>
          <p className="tabular font-display text-[15px] font-bold">{r.advanceAmount > 0 ? rupees(r.advanceAmount) : "None"}</p>
        </div>
        <Link
          to={`/check-in?reservation=${r.id}`}
          className="flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
        >
          <CalendarCheck className="size-4" aria-hidden />
          Check in
        </Link>
      </div>
    </article>
  );
}

function Empty({ tab, searching }: { tab: Tab; searching: boolean }) {
  if (searching) return <p className="py-10 text-center text-sm text-muted">No guests match your search.</p>;
  const copy: Record<Tab, [string, string]> = {
    in_house: ["No guests in-house", "Checked-in guests will show here."],
    arrivals: ["No arrivals today", "Bookings due today will show here."],
    departures: ["No departures yet", "Guests due out, checked out or cancelled today will show here."],
  };
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-paper">
      <EmptyState icon={<CalendarCheck className="size-5" />} title={copy[tab][0]} body={copy[tab][1]} />
    </div>
  );
}
