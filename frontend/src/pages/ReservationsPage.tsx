import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarDays, Check, ChevronLeft, ChevronRight, LogIn, MessageCircle, Pencil, Plus, UserX, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { WhatsAppSend } from "../components/WhatsAppSend";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select, Sheet, Spinner, Stepper, Textarea } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { rupees, toPaise } from "../lib/format";
import { useCurrentProperty } from "../lib/property";
import {
  addDays,
  dayLabel,
  hotelToday,
  isoDay,
  nightsBetween,
  useInvalidateBookings,
  useReservation,
  useReservations,
  type AvailableRoom,
  type Reservation,
} from "../lib/reservations";
import { formatPhone, payModeLabel, type PayMode } from "../lib/stays";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Bookings occupying a night: arrival day up to, not including, checkout day. */
const onDay = (r: Reservation, day: string) => r.checkIn <= day && day < r.checkOut;

function shade(count: number): string {
  if (count >= 6) return "border-teal-400 bg-teal-300";
  if (count >= 4) return "border-teal-300 bg-teal-200";
  if (count >= 2) return "border-teal-200 bg-teal-100";
  if (count === 1) return "border-teal-100 bg-teal-50";
  return "border-line bg-paper";
}

export function ReservationsPage() {
  const property = useCurrentProperty();
  const today = hotelToday();
  const thisMonth = () => new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1);
  const [month, setMonth] = useState(thisMonth);
  const [selected, setSelected] = useState(today);
  const [editing, setEditing] = useState<Reservation | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);
  const from = isoDay(days[0]);
  const to = addDays(isoDay(days[41]), 1);
  const q = useReservations(property.id, from, to);
  const list = useMemo(() => q.data ?? [], [q.data]);
  const dayList = list.filter((r) => onDay(r, selected));
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <>
      <PageHeader
        title="Reservations"
        description="Plan arrivals and manage bookings by date."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            New booking
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarDays className="size-4 text-muted" aria-hidden />
              {month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMonth(thisMonth());
                  setSelected(today);
                }}
              >
                Today
              </Button>
              <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => shift(1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          {q.error ? (
            <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted sm:gap-1.5">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="pb-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {days.map((d) => {
                  const iso = isoDay(d);
                  const count = list.filter((r) => onDay(r, iso)).length;
                  const inMonth = d.getMonth() === month.getMonth();
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setSelected(iso)}
                      aria-pressed={selected === iso}
                      aria-label={`${dayLabel(iso)}, ${count} ${count === 1 ? "booking" : "bookings"}`}
                      className={clsx(
                        "relative flex aspect-square flex-col rounded-lg border p-1.5 text-left transition-colors sm:p-2 lg:aspect-[1.25]",
                        shade(count),
                        !inMonth && "opacity-45",
                        selected === iso ? "ring-2 ring-teal-700 ring-offset-1" : "hover:border-line-strong",
                      )}
                    >
                      <span className={clsx("tabular text-sm font-semibold", iso === today ? "text-marigold-700" : "text-ink")}>{d.getDate()}</span>
                      {iso === today && <span className="absolute top-2 right-2 size-1.5 rounded-full bg-marigold-400" aria-hidden />}
                      {count > 0 && <span className="tabular mt-auto text-[11px] font-semibold text-teal-800">{count}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-marigold-400" aria-hidden /> Today
                </span>
                {[
                  ["1 booking", "bg-teal-50 border-teal-100"],
                  ["2–3", "bg-teal-100 border-teal-200"],
                  ["4–5", "bg-teal-200 border-teal-300"],
                  ["6+", "bg-teal-300 border-teal-400"],
                ].map(([label, cls]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span className={clsx("size-3 rounded border", cls)} aria-hidden /> {label}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className="self-start overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold">{dayLabel(selected)}</h2>
            <span className="text-sm text-muted">
              {dayList.length} {dayList.length === 1 ? "booking" : "bookings"}
            </span>
          </div>
          {q.isLoading ? (
            <Spinner />
          ) : dayList.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-muted">No bookings on this day.</p>
              {selected >= today && (
                <button type="button" onClick={() => setEditing("new")} className="mt-2 text-sm font-semibold text-teal-700 hover:underline">
                  Add a booking
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {dayList.map((r) => (
                <li key={r.id}>
                  <BookingRow r={r} onOpen={() => setOpenId(r.id)} day={selected} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {editing && (
        <BookingForm
          booking={editing === "new" ? null : editing}
          initialCheckIn={selected >= today ? selected : today}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            setEditing(null);
            setOpenId(r.id);
          }}
        />
      )}
      {openId && (
        <BookingSheet
          id={openId}
          onClose={() => setOpenId(null)}
          onEdit={(r) => {
            setOpenId(null);
            setEditing(r);
          }}
        />
      )}
    </>
  );
}

export function BookingRow({ r, onOpen, day }: { r: Reservation; onOpen: () => void; day?: string }) {
  const arriving = day === r.checkIn;
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-sand/60">
      <span className="tabular flex size-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 font-display text-lg font-semibold text-teal-800">{r.roomNumber}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{r.guestName}</span>
        <span className="block truncate text-xs text-muted">
          {dayLabel(r.checkIn)} – {dayLabel(r.checkOut)}
        </span>
      </span>
      {r.status === "checked_in" ? (
        <span className="rounded-full bg-occupied-bg px-2 py-0.5 text-xs font-semibold text-occupied">Checked in</span>
      ) : arriving ? (
        <span className="rounded-full bg-marigold-50 px-2 py-0.5 text-xs font-semibold text-marigold-700">Arrives</span>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
    </button>
  );
}

function BookingForm({ booking, initialCheckIn, onClose, onSaved }: { booking: Reservation | null; initialCheckIn: string; onClose: () => void; onSaved: (r: Reservation) => void }) {
  const property = useCurrentProperty();
  const pid = property.id;
  const fd = property.frontDesk;
  const invalidate = useInvalidateBookings(pid);
  const today = hotelToday();
  const [name, setName] = useState(booking?.guestName ?? "");
  const [phone, setPhone] = useState(booking?.guestPhone ?? "");
  const [checkIn, setCheckIn] = useState(booking?.checkIn ?? initialCheckIn);
  const [checkOut, setCheckOut] = useState(booking?.checkOut ?? addDays(initialCheckIn, 1));
  const [roomId, setRoomId] = useState(booking?.roomId ?? "");
  const [rate, setRate] = useState(booking ? String(booking.nightlyRate / 100) : "");
  const [adults, setAdults] = useState(booking?.adults ?? 1);
  const [children, setChildren] = useState(booking?.children ?? 0);
  const [advance, setAdvance] = useState(booking?.advanceAmount ? String(booking.advanceAmount / 100) : "");
  const [mode, setMode] = useState<PayMode>(booking?.advanceMode ?? "upi");
  const [reference, setReference] = useState(booking?.advanceReference ?? "");
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [consent, setConsent] = useState(booking?.whatsappConsent ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validDates = checkOut > checkIn;
  const rooms = useQuery({
    queryKey: ["availability", pid, checkIn, checkOut, booking?.id ?? ""],
    queryFn: () => api<AvailableRoom[]>(`/properties/${pid}/reservations/availability?from=${checkIn}&to=${checkOut}&exclude=${booking?.id ?? ""}`),
    enabled: validDates,
    staleTime: 0,
  });
  const available = useMemo(() => rooms.data ?? [], [rooms.data]);

  // Keep the choice valid when dates change, and default the rate from the room.
  useEffect(() => {
    if (!rooms.data) return;
    if (!available.some((r) => r.id === roomId)) {
      const first = available[0];
      setRoomId(first?.id ?? "");
      setRate(first ? String(first.baseRate / 100) : "");
    }
  }, [rooms.data, available, roomId]);

  const nights = validDates ? nightsBetween(checkIn, checkOut) : 0;
  const ratePaise = toPaise(rate) ?? 0;
  const gstPct = !fd.gstRegistered ? 0 : ratePaise <= fd.roomGstThreshold ? fd.roomGstLow : fd.roomGstHigh;
  const total = Math.round(ratePaise * nights * (1 + gstPct / 100));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        guestName: name,
        guestPhone: phone,
        roomId,
        checkIn,
        checkOut,
        adults,
        children,
        nightlyRate: toPaise(rate) ?? -1,
        advanceAmount: toPaise(advance) ?? 0,
        advanceMode: mode,
        advanceReference: reference,
        notes,
        whatsappConsent: consent,
      };
      return booking
        ? api<Reservation>(`/properties/${pid}/reservations/${booking.id}`, { method: "PUT", body })
        : api<Reservation>(`/properties/${pid}/reservations`, { method: "POST", body });
    },
    onSuccess: (r) => {
      invalidate();
      onSaved(r);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      void rooms.refetch();
    },
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title={booking ? "Edit booking" : "New booking"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!roomId}
            onClick={() => {
              setErrors({});
              save.mutate();
            }}
          >
            {booking ? "Save changes" : "Create booking"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Guest name" error={errors.guestName}>
          {(id, d) => <Input id={id} aria-describedby={d} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.guestName} />}
        </Field>
        <Field label="Mobile number" error={errors.guestPhone} hint="Used for the WhatsApp confirmation.">
          {(id, d) => <Input id={id} aria-describedby={d} type="tel" placeholder="98470 12345" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={!!errors.guestPhone} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Arrival" error={errors.checkIn}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                type="date"
                min={booking && booking.checkIn < today ? booking.checkIn : today}
                value={checkIn}
                invalid={!!errors.checkIn}
                onChange={(e) => {
                  const v = e.target.value;
                  setCheckIn(v);
                  if (v && checkOut <= v) setCheckOut(addDays(v, 1));
                }}
              />
            )}
          </Field>
          <Field label="Checkout" error={errors.checkOut ?? (!validDates ? "Must be after arrival." : undefined)} hint={nights ? `${nights} ${nights === 1 ? "night" : "nights"}` : undefined}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" min={addDays(checkIn, 1)} value={checkOut} invalid={!!errors.checkOut || !validDates} onChange={(e) => setCheckOut(e.target.value)} />}
          </Field>
        </div>
        <Field label="Room" error={errors.roomId} hint={rooms.data ? `${available.length} free for these dates` : undefined}>
          {(id, d) =>
            rooms.data && available.length === 0 ? (
              <p id={id} className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
                No rooms are free for these dates.
              </p>
            ) : (
              <Select
                id={id}
                aria-describedby={d}
                value={roomId}
                invalid={!!errors.roomId}
                onChange={(e) => {
                  setRoomId(e.target.value);
                  const r = available.find((x) => x.id === e.target.value);
                  if (r) setRate(String(r.baseRate / 100));
                }}
              >
                {available.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.number} · {r.typeName} · {rupees(r.baseRate)}
                  </option>
                ))}
              </Select>
            )
          }
        </Field>
        <Field label="Rate per night (before GST)" error={errors.nightlyRate}>
          {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} invalid={!!errors.nightlyRate} />}
        </Field>
        <div className="flex gap-6">
          <Field label="Adults" error={errors.adults}>
            {(id) => <Stepper id={id} label="adults" min={1} value={adults} onChange={setAdults} />}
          </Field>
          <Field label="Children" error={errors.children}>
            {(id) => <Stepper id={id} label="children" value={children} onChange={setChildren} />}
          </Field>
        </div>
        {nights > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-sand/60 px-4 py-3 text-sm">
            <span className="text-ink-soft">
              Estimated room charge{gstPct > 0 ? ` incl. ${gstPct}% GST` : ""}
            </span>
            <span className="tabular font-display text-lg font-semibold">{rupees(total)}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Advance received" optional error={errors.advanceAmount}>
            {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" placeholder="0" value={advance} onChange={(e) => setAdvance(e.target.value)} invalid={!!errors.advanceAmount} />}
          </Field>
          <Field label="Method" error={errors.advanceMode}>
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={mode} onChange={(e) => setMode(e.target.value as PayMode)}>
                {(Object.keys(payModeLabel) as PayMode[]).map((m) => (
                  <option key={m} value={m}>
                    {payModeLabel[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Reference / UTR" optional>
          {(id, d) => <Input id={id} aria-describedby={d} className="font-mono" value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
        <Field label="Notes" optional>
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-teal-700" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="font-medium">Guest agrees to receive WhatsApp messages</span>
        </label>
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
      </div>
    </Sheet>
  );
}

export function BookingSheet({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit?: (r: Reservation) => void }) {
  const property = useCurrentProperty();
  const pid = property.id;
  const q = useReservation(pid, id);
  const invalidate = useInvalidateBookings(pid);
  const [panel, setPanel] = useState<"view" | "cancel" | "noshow" | "whatsapp">("view");
  const [reason, setReason] = useState("");
  const close = useMutation({
    mutationFn: (kind: "cancel" | "no-show") =>
      api(`/properties/${pid}/reservations/${id}/${kind}`, { method: "POST", ...(kind === "cancel" ? { body: { reason } } : {}) }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const r = q.data;
  if (panel === "whatsapp") {
    return (
      <WhatsAppSend
        propertyId={pid}
        reservationId={id}
        kind="booking"
        open
        onClose={() => {
          invalidate();
          setPanel("view");
        }}
      />
    );
  }

  if (r && (panel === "cancel" || panel === "noshow")) {
    const cancelling = panel === "cancel";
    return (
      <Sheet
        open
        onClose={() => setPanel("view")}
        title={cancelling ? `Cancel ${r.guestName}'s booking?` : `Mark ${r.guestName} as a no-show?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPanel("view")}>
              Keep booking
            </Button>
            <Button variant="danger" loading={close.isPending} onClick={() => close.mutate(cancelling ? "cancel" : "no-show")}>
              {cancelling ? "Cancel booking" : "Mark no-show"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-soft">Room {r.roomNumber} becomes free for these dates.</p>
        {r.advanceAmount > 0 && (
          <p className="mt-3 rounded-lg bg-marigold-50 px-3 py-2 text-sm text-marigold-700">
            {rupees(r.advanceAmount)} advance was received. If you're returning it, refund the guest separately; Guestlog doesn't record that refund.
          </p>
        )}
        {cancelling && (
          <div className="mt-4">
            <Field label="Reason" optional>
              {(fid, d) => <Input id={fid} aria-describedby={d} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          </div>
        )}
        {close.error && (
          <div className="mt-3">
            <ErrorNote message={close.error.message} />
          </div>
        )}
      </Sheet>
    );
  }

  const booked = r?.status === "booked";
  return (
    <Sheet
      open
      onClose={onClose}
      title={r ? r.guestName : "Booking"}
      description={r ? `Room ${r.roomNumber} · ${r.roomType}` : undefined}
      footer={
        r && booked ? (
          <Link to={`/check-in?reservation=${r.id}`}>
            <Button icon={<LogIn className="size-4" />}>Check in</Button>
          </Link>
        ) : r?.stayId ? (
          <Link to={`/stays/${r.stayId}`}>
            <Button>Open stay</Button>
          </Link>
        ) : undefined
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !r ? (
        <ErrorNote message={q.error?.message ?? "Couldn't load this booking."} onRetry={() => q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="divide-y divide-line rounded-lg border border-line text-sm">
            {(
              [
                ["Arrival", dayLabel(r.checkIn)],
                ["Checkout", `${dayLabel(r.checkOut)} · ${nightsBetween(r.checkIn, r.checkOut)} ${nightsBetween(r.checkIn, r.checkOut) === 1 ? "night" : "nights"}`],
                ["Guests", `${r.adults} ${r.adults === 1 ? "adult" : "adults"}${r.children ? `, ${r.children} ${r.children === 1 ? "child" : "children"}` : ""}`],
                ["Phone", formatPhone(r.guestPhone)],
                ["Rate", `${rupees(r.nightlyRate)} / night`],
                ["Advance", r.advanceAmount ? `${rupees(r.advanceAmount)}${r.advanceMode ? ` · ${payModeLabel[r.advanceMode]}` : ""}${r.advanceReference ? ` · ${r.advanceReference}` : ""}` : "None"],
                ...(r.notes ? ([["Notes", r.notes]] as [string, string][]) : []),
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {booked ? (
            <>
              <Button variant="secondary" className="justify-start" icon={r.confirmationSent ? <Check className="size-4" /> : <MessageCircle className="size-4" />} onClick={() => setPanel("whatsapp")}>
                {r.confirmationSent ? "Confirmation sent · send again" : "Send WhatsApp confirmation"}
              </Button>
              {onEdit && (
                <Button variant="secondary" className="justify-start" icon={<Pencil className="size-4" />} onClick={() => onEdit(r)}>
                  Edit booking
                </Button>
              )}
              <div className="flex gap-2">
                {r.checkIn <= hotelToday() && (
                  <Button variant="ghost" className="flex-1" icon={<UserX className="size-4" />} onClick={() => setPanel("noshow")}>
                    No-show
                  </Button>
                )}
                <Button variant="ghost" className="flex-1 text-danger hover:bg-danger-bg hover:text-danger" icon={<XCircle className="size-4" />} onClick={() => setPanel("cancel")}>
                  Cancel booking
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              {r.status === "checked_in" ? "This guest has checked in." : r.status === "cancelled" ? `Cancelled${r.cancelReason ? `: ${r.cancelReason}` : "."}` : "Marked as a no-show."}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
