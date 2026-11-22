import clsx from "clsx";
import { ArrowRight, LogIn, Sparkles, Star, UserPlus, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, PageHeader } from "../components/ui";
import { WhatsAppSend } from "../components/WhatsAppSend";
import { canManage, useAuth } from "../lib/auth";
import { todayLabel } from "../lib/format";
import { useCurrentProperty } from "../lib/property";
import { statusMeta, useRooms, type RoomStatus } from "../lib/rooms";
import { addDays, dayLabel, hotelToday, useReservations } from "../lib/reservations";
import { useStays, type StaySummary } from "../lib/stays";
import { StayRow } from "./GuestsPage";
import { SubscriptionMarquee } from "../components/SubscriptionMarquee";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function TodayPage() {
  const { user } = useAuth();
  const property = useCurrentProperty();
  const rooms = useRooms(property.id);
  const isHousekeeping = user?.role === "housekeeping";
  const stays = useStays(property.id, "in_house");
  const sessionStays = useStays(property.id, "today_session");
  const s = rooms.data?.summary;
  const firstName = user?.name.split(" ")[0] ?? "";
  const [reviewStay, setReviewStay] = useState<StaySummary | null>(null);

  const todayIso = hotelToday();
  // Late arrivals still hold their room, so look back a little.
  const bookings = useReservations(property.id, addDays(todayIso, -14), addDays(todayIso, 1), !isHousekeeping);
  const arrivals = (bookings.data ?? []).filter((r) => r.status === "booked" && r.checkIn <= todayIso && r.checkOut > todayIso);

  const today = new Date().toDateString();
  const leaving = (stays.data ?? []).filter((x) => new Date(x.expectedCheckOutAt).toDateString() === today || new Date(x.expectedCheckOutAt) < new Date());
  
  // Today's session breakdowns
  const sessionList = sessionStays.data ?? [];
  const todayCheckIns = sessionList.filter((x) => x.status === "in_house" && x.checkInAt.slice(0, 10) === todayIso);
  const todayCancelled = sessionList.filter((x) => x.status === "cancelled");
  const todayCheckouts = sessionList.filter((x) => x.status === "checked_out");
  const otherInHouse = (stays.data ?? []).filter((x) => x.checkInAt.slice(0, 10) !== todayIso);

  return (
    <>
      <SubscriptionMarquee />
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`${todayLabel()} · ${property.name}`}
        actions={
          <div className="flex items-center gap-2">
            {canManage(user?.role) && (
              <Link to="/staff">
                <Button variant="secondary" icon={<UserPlus className="size-4" />}>Staff logins</Button>
              </Link>
            )}
            {!isHousekeeping && (
              <Link to="/check-in">
                <Button icon={<LogIn className="size-4" />}>New check-in</Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["ready", "occupied", "cleaning", "maintenance"] as RoomStatus[]).map((k) => (
          <Link key={k} to="/rooms" className="group">
            <Card className="h-full px-4 py-4 transition-colors group-hover:border-line-strong">
              <div className="flex items-center gap-2">
                <span className={clsx("size-2 rounded-full", statusMeta[k].bar)} aria-hidden />
                <span className="text-sm font-medium text-ink-soft">{statusMeta[k].label}</span>
              </div>
              <p className="tabular mt-2 font-display text-3xl font-bold">{s ? s[k] : "–"}</p>
            </Card>
          </Link>
        ))}
      </div>

      {s && s.cleaning > 0 && (
        <Link
          to="/rooms"
          className="mt-4 flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-700 hover:bg-accent-100"
        >
          <Sparkles className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            <strong className="font-semibold">
              {s.cleaning} {s.cleaning === 1 ? "room needs" : "rooms need"} cleaning
            </strong>{" "}
            before they can be assigned.
          </span>
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}

      {/* ---------- Today's Session Section ---------- */}
      {!isHousekeeping && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ready opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-ready" />
              </span>
              <h2 className="font-display font-bold text-lg text-ink">Today's Session</h2>
            </div>
            <span className="text-xs text-muted font-medium">Active operational session for {todayIso}</span>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Newly Created Check-ins (Current Session) */}
            <Card className="overflow-hidden border-brand-200 shadow-xs">
              <div className="flex items-center justify-between border-b border-line bg-brand-50/40 px-5 py-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-brand-900">New check-ins (Current Session)</h3>
                  <span className="inline-flex items-center rounded-full bg-ready-bg px-2 py-0.5 text-[10px] font-bold text-ready">
                    Current
                  </span>
                </div>
                <span className="text-sm font-bold text-brand-700">{todayCheckIns.length}</span>
              </div>

              {todayCheckIns.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted">
                  <p>No new check-ins created today yet.</p>
                  <Link to="/check-in" className="mt-2 inline-block font-semibold text-brand-700 hover:underline">
                    Start a new check-in
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {todayCheckIns.map((x) => (
                    <li key={x.id}>
                      <StayRow s={x} isCurrentSession highlight />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Cancellations & Recent Checkouts */}
            <div className="flex flex-col gap-5">
              {/* Cancellations */}
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-5 py-3">
                  <div className="flex items-center gap-2">
                    <XCircle className="size-4 text-danger" />
                    <h3 className="font-semibold text-ink">Cancelled Check-ins</h3>
                  </div>
                  <span className="text-sm text-muted">{todayCancelled.length}</span>
                </div>

                {todayCancelled.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-muted">No cancelled check-ins today.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {todayCancelled.map((x) => (
                      <li key={x.id}>
                        <StayRow s={x} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Recent Check-outs (With Optional Google Review Request) */}
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Star className="size-4 text-accent-700" />
                    <h3 className="font-semibold text-ink">Recent Check-outs</h3>
                  </div>
                  <span className="text-sm text-muted">{todayCheckouts.length}</span>
                </div>

                {todayCheckouts.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-muted">No checkouts completed yet today.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {todayCheckouts.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sand/60">
                        <Link to={`/stays/${x.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="tabular flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-sand font-display font-bold text-ink">
                            {x.roomNumber}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            <span className="block truncate font-semibold">{x.guestName}</span>
                            <span className="block truncate text-xs text-muted">Checked out · Room {x.roomNumber}</span>
                          </span>
                        </Link>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Star className="size-3.5 text-accent-700" />}
                          onClick={() => setReviewStay(x)}
                          title="Send Google review request (optional)"
                        >
                          Send review
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* Arriving Today */}
      {!isHousekeeping && arrivals.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold">Arriving today</h2>
            <span className="text-sm text-muted">{arrivals.length}</span>
          </div>
          <ul className="divide-y divide-line">
            {arrivals.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <span className="tabular flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-sand font-display text-lg font-bold text-ink">
                  {r.roomNumber}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.guestName}</span>
                  <span className="block truncate text-xs text-muted">
                    {r.checkIn < todayIso ? `Late arrival · was due ${dayLabel(r.checkIn)}` : `Until ${dayLabel(r.checkOut)}`}
                  </span>
                </span>
                <Link to={`/check-in?reservation=${r.id}`}>
                  <Button size="sm">Check in</Button>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Other in-house & leaving today */}
      {!isHousekeeping && (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold">Leaving today</h2>
              <span className="text-sm text-muted">{leaving.length}</span>
            </div>
            {leaving.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">No checkouts due today.</p>
            ) : (
              <ul className="divide-y divide-line">
                {leaving.map((x) => (
                  <li key={x.id}>
                    <StayRow s={x} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold">Other In-house Guests</h2>
              <span className="text-sm text-muted">{otherInHouse.length}</span>
            </div>
            {otherInHouse.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted">
                <p>No other guests in-house.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {otherInHouse.map((x) => (
                  <li key={x.id}>
                    <StayRow s={x} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Google Review Request Modal */}
      {reviewStay && (
        <WhatsAppSend
          propertyId={property.id}
          stayId={reviewStay.id}
          kind="review"
          open={!!reviewStay}
          onClose={() => setReviewStay(null)}
        />
      )}
    </>
  );
}
