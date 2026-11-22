/**
 * Concept A, "Key rack": the hotel at a glance. Every room is a key tag on
 * its floor's row, the way keys hang behind a reception desk. Tap a tag to act.
 */
import clsx from "clsx";
import { LogIn, LogOut, Sparkles, Wallet } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Fab, ListGroup, ListRow } from "../../components/mobile";
import { Button, Sheet } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { initials, rupees } from "../../lib/format";
import { haptic } from "../../lib/native";
import { useCurrentProperty } from "../../lib/property";
import { dayLabel } from "../../lib/reservations";
import { useSetRoomStatus, type Room } from "../../lib/rooms";
import { useToday } from "../../lib/today";

const longDate = () => new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

export function HomeKeyRack() {
  const { user } = useAuth();
  const t = useToday(user?.role);
  const [open, setOpen] = useState<Room | null>(null);
  const arrivingRooms = new Set(t.arrivals.map((a) => a.roomId));
  const occupied = t.rooms.filter((r) => r.status === "occupied").length;
  const floors = [...new Set(t.rooms.map((r) => r.floor))].sort((a, b) => a - b);
  const desk = user?.role !== "housekeeping";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted">{longDate()}</p>
        <h1 className="mt-1 font-display text-[26px] leading-tight font-bold">
          {occupied} of {t.rooms.length} rooms occupied
        </h1>
      </header>

      <section className="surface px-4 pt-4 pb-3" aria-label="Rooms">
        <div className="flex flex-col gap-4">
          {floors.map((f) => (
            <div key={f}>
              <p className="mb-2 text-[12px] font-medium text-muted">{f === 0 ? "Ground floor" : `Floor ${f}`}</p>
              <div className="grid grid-cols-5 gap-2">
                {t.rooms
                  .filter((r) => r.floor === f)
                  .map((r) => (
                    <KeyTag key={r.id} r={r} arriving={arrivingRooms.has(r.id)} onClick={() => { haptic(); setOpen(r); }} />
                  ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line/70 pt-3 text-[11px] text-muted">
          <Legend className="bg-paper ring-1 ring-line-strong" label="Ready" />
          <Legend className="bg-ink" label="Occupied" />
          <Legend className="bg-accent-300" label="Cleaning" />
          <Legend className="bg-line-strong" label="Out of order" />
          <Legend className="bg-paper ring-2 ring-brand-700" label="Arriving today" />
        </div>
      </section>

      {desk && (
        <ListGroup title="Today">
          <ListRow to="/reservations" icon={LogIn} title={`${t.arrivals.length} arriving`} subtitle={t.arrivals.map((a) => a.guestName.split(" ")[0]).join(", ") || "No bookings due today"} />
          <ListRow to="/" icon={LogOut} title={`${t.leaving.length} leaving`} subtitle={t.overdue.length ? `${t.overdue.length} past checkout` : "Due out today"} badge={t.overdue.length || undefined} />
          <ListRow to="/guests" icon={Wallet} title={`${rupees(t.toCollect)} to collect`} subtitle={`From ${t.inHouse.filter((s) => s.balance > 0).length} in-house guests`} />
        </ListGroup>
      )}

      <div className="h-16" aria-hidden />
      {desk && <Fab to="/check-in" icon={LogIn} label="Check in" />}
      {open && <RoomSheet r={open} arriving={t.arrivals.find((a) => a.roomId === open.id)} onClose={() => setOpen(null)} desk={desk} />}
    </div>
  );
}

function KeyTag({ r, arriving, onClick }: { r: Room; arriving: boolean; onClick: () => void }) {
  const tone = {
    occupied: "bg-ink text-white",
    ready: "bg-paper text-ink ring-1 ring-line-strong",
    cleaning: "bg-accent-200 text-accent-700",
    maintenance: "bg-sand text-muted [background-image:repeating-linear-gradient(135deg,transparent_0_6px,var(--color-line)_6px_7px)]",
  }[r.status];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Room ${r.number}, ${r.status}${r.guestName ? `, ${r.guestName}` : ""}`}
      className={clsx("pressable relative flex h-[62px] flex-col items-center justify-center rounded-xl pt-1.5", tone, arriving && "ring-2 ring-brand-700")}
    >
      {/* the hole a key ring goes through */}
      <span className={clsx("absolute top-1.5 size-1.5 rounded-full", r.status === "occupied" ? "bg-white/40" : "bg-ink/15")} aria-hidden />
      <span className="tabular font-display text-[15px] leading-none font-bold">{r.number}</span>
      <span className="mt-1 h-3 text-[10px] leading-none font-semibold opacity-80">
        {r.status === "occupied" && r.guestName ? initials(r.guestName) : arriving ? "Due" : ""}
      </span>
    </button>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={clsx("size-2.5 rounded-[3px]", className)} aria-hidden />
      {label}
    </span>
  );
}

function RoomSheet({ r, arriving, onClose, desk }: { r: Room; arriving?: { id: string; guestName: string; checkOut: string }; onClose: () => void; desk: boolean }) {
  const property = useCurrentProperty();
  const setStatus = useSetRoomStatus(property.id);
  const label = { ready: "Ready", occupied: "Occupied", cleaning: "Needs cleaning", maintenance: "Out of order" }[r.status];
  return (
    <Sheet open onClose={onClose} title={`Room ${r.number}`} description={`${r.typeName}, ${r.bedType} · ${label}`}>
      <div className="flex flex-col gap-3">
        {r.status === "occupied" && r.guestName && (
          <div className="rounded-xl bg-sand px-4 py-3">
            <p className="font-semibold">{r.guestName}</p>
            {r.expectedCheckOutAt && <p className="text-sm text-muted">Due out {dayLabel(r.expectedCheckOutAt.slice(0, 10))}</p>}
          </div>
        )}
        {arriving && (
          <div className="rounded-xl bg-brand-50 px-4 py-3 text-brand-800">
            <p className="font-semibold">{arriving.guestName} arrives today</p>
            <p className="text-sm">Until {dayLabel(arriving.checkOut)}</p>
          </div>
        )}
        {desk && r.stayId && (
          <Link to={`/stays/${r.stayId}`} onClick={onClose}>
            <Button className="h-12 w-full">Open stay</Button>
          </Link>
        )}
        {desk && r.status === "ready" && (
          <Link to={arriving ? `/check-in?reservation=${arriving.id}` : `/check-in?room=${r.id}`} onClick={onClose}>
            <Button className="h-12 w-full" icon={<LogIn className="size-4" />}>
              {arriving ? `Check in ${arriving.guestName.split(" ")[0]}` : "Check in a walk-in"}
            </Button>
          </Link>
        )}
        {r.status === "cleaning" && (
          <Button
            className="h-12 w-full"
            icon={<Sparkles className="size-4" />}
            loading={setStatus.isPending}
            onClick={() => setStatus.mutate({ roomId: r.id, status: "ready" }, { onSuccess: onClose })}
          >
            Mark as cleaned
          </Button>
        )}
      </div>
    </Sheet>
  );
}
