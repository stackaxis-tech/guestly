import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, BadgeCheck, BedDouble, CalendarPlus, Clock, IdCard, Loader2, Plus, ShieldCheck, Sparkles, Trash2, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CameraCapture } from "../components/CameraCapture";
import { Button, Card, Disclosure, ErrorNote, Field, Input, PageHeader, Select, Stepper, Textarea } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { clock12, rupees, toPaise } from "../lib/format";
import { useCurrentProperty } from "../lib/property";
import {
  addDays as bookingAddDays,
  arrivalNight,
  dayLabel,
  hotelDateOf,
  hotelDateTimeLabel,
  hotelInstant,
  hotelNow,
  hotelToday,
  useReservation,
  type AvailableRoom,
} from "../lib/reservations";
import { canScan, scanBothSides, scanDocument, ScanError, type ScanResult } from "../lib/idscan";
import { useRooms } from "../lib/rooms";
import {
  COUNTRIES,
  docTypeLabel,
  formatPhone,
  uploadGuestImage,
  type DocType,
  type Guest,
  type GuestDocument,
  type PayMode,
  type StayDetail,
} from "../lib/stays";

type Errors = Record<string, string>;

type PersonForm = {
  name: string;
  nationality: string;
  email: string;
  address: string;
  gender: string;
  birthYear: string;
};

type DocForm = {
  type: DocType;
  number: string;
  front: Blob | null;
  back: Blob | null;
  visaNumber: string;
  visaExpiry: string;
};

type Companion = { key: number; person: PersonForm; addId: boolean; doc: DocForm };

const emptyPerson = (): PersonForm => ({ name: "", nationality: "IN", email: "", address: "", gender: "", birthYear: "" });
const emptyDoc = (nationality = "IN"): DocForm => ({
  type: nationality === "IN" ? "aadhaar" : "passport",
  number: "",
  front: null,
  back: null,
  visaNumber: "",
  visaExpiry: "",
});

function nightsBetween(fromISO: string, toISO: string) {
  const a = new Date(fromISO + "T00:00:00");
  const b = new Date(toISO + "T00:00:00");
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function Section({
  icon: Icon,
  title,
  description,
  aside,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="px-5 py-5 sm:px-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-sand text-ink-soft">
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children}
    </Card>
  );
}

function PersonFields({ value, onChange, errors, prefix, compact }: { value: PersonForm; onChange: (p: PersonForm) => void; errors: Errors; prefix: string; compact?: boolean }) {
  const set = (k: keyof PersonForm) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name (as on ID)" error={errors[prefix + "name"]} className="sm:col-span-2">
        {(id, d) => <Input id={id} aria-describedby={d} autoComplete="off" value={value.name} onChange={set("name")} invalid={!!errors[prefix + "name"]} />}
      </Field>
      <Field label="Nationality" error={errors[prefix + "nationality"]}>
        {(id, d) => (
          <Select id={id} aria-describedby={d} value={value.nationality} onChange={set("nationality")}>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {!compact && (
        <Field label="Address" optional className="sm:col-span-2" error={errors[prefix + "address"]} hint="Needed for the police guest register in most states.">
          {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} value={value.address} onChange={set("address")} />}
        </Field>
      )}
      {!compact && (
        <Disclosure summary="Gender, email, year of birth (optional)" className="sm:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Gender" optional>
              {(id, d) => (
                <Select id={id} aria-describedby={d} value={value.gender} onChange={set("gender")}>
                  <option value="">Prefer not to say</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </Select>
              )}
            </Field>
            <Field label="Email" optional error={errors[prefix + "email"]}>
              {(id, d) => <Input id={id} aria-describedby={d} type="email" value={value.email} onChange={set("email")} invalid={!!errors[prefix + "email"]} />}
            </Field>
            <Field label="Year of birth" optional error={errors[prefix + "birthYear"]}>
              {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" maxLength={4} value={value.birthYear} onChange={set("birthYear")} />}
            </Field>
          </div>
        </Disclosure>
      )}
    </div>
  );
}

/** Fills empty fields from an ID scan. Differing values are kept unless forced, and reported as conflicts. */
function mergeScan(p: PersonForm, d: ScanResult, force: boolean): { next: PersonForm; conflicts: string[] } {
  const next = { ...p };
  const conflicts: string[] = [];
  const fields: [keyof PersonForm, string, string][] = [
    ["name", d.name, "name"],
    ["gender", d.gender, "gender"],
    ["birthYear", d.birthYear ? String(d.birthYear) : "", "year of birth"],
    ["address", d.address, "address"],
    ["nationality", d.nationality, "nationality"],
  ];
  for (const [key, scanned, label] of fields) {
    if (!scanned) continue;
    // India is only the form's default, so a passport's nationality replaces it.
    const current = key === "nationality" && p.nationality === "IN" ? "" : p[key].trim();
    if (!current || force) next[key] = scanned;
    else if (current.toLowerCase() !== scanned.toLowerCase()) conflicts.push(label);
  }
  return { next, conflicts };
}

type ScanState =
  | { state: "reading"; type: DocType; message: string }
  | { state: "done"; type: DocType; details: ScanResult; conflicts: string[] }
  | { state: "failed"; type: DocType; message: string };

function ScanNote({ scan, onUseScanned }: { scan: ScanState; onUseScanned: () => void }) {
  const label = docTypeLabel[scan.type];
  if (scan.state === "reading") {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-sand/60 px-3 py-2 text-sm text-ink-soft" role="status">
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> {scan.message}
      </p>
    );
  }
  if (scan.state === "failed") {
    return (
      <div className="rounded-lg bg-accent-50/80 border border-accent-200 px-3.5 py-2.5 text-sm text-accent-800" role="status">
        <p className="font-medium">{scan.message}</p>
        <p className="mt-1 text-xs text-muted">You can manually type the guest details in the form above and ID number below.</p>
      </div>
    );
  }
  const d = scan.details;
  const expired = d.expiry && d.expiry < hotelToday();
  const extractedList: string[] = [];
  if (d.name) extractedList.push(`Name: ${d.name}`);
  if (d.number) extractedList.push(`ID No: ${d.number}`);
  if (d.birthYear) extractedList.push(`Birth Year: ${d.birthYear}`);
  if (d.gender) extractedList.push(`Gender: ${d.gender}`);
  if (d.address) extractedList.push(`Address: ${d.address}`);

  return (
    <div className="rounded-lg bg-ready-bg/70 border border-ready/20 px-3.5 py-2.5 text-sm text-ready" role="status">
      <p className="flex items-center gap-2 font-medium">
        <BadgeCheck className="size-4 shrink-0" aria-hidden /> Details extracted from {label} and auto-populated.
      </p>
      {extractedList.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-ink-soft">
          {extractedList.map((item, idx) => (
            <span key={idx} className="rounded bg-paper px-2 py-0.5 border border-line font-medium">
              {item}
            </span>
          ))}
        </div>
      )}
      {expired && <p className="mt-1 font-semibold text-danger">This passport expired on {dayLabel(d.expiry)}.</p>}
      {scan.conflicts.length > 0 && (
        <p className="mt-1.5 text-xs text-muted">
          The {label} shows a different {scan.conflicts.join(", ")}.{" "}
          <button type="button" className="font-semibold underline text-ink hover:text-brand-700" onClick={onUseScanned}>
            Overwrite with {label} details
          </button>
        </p>
      )}
    </div>
  );
}

const scanHint: Record<DocType, string> = {
  aadhaar: "Card photo or QR code to auto-fill details",
  passport: "Photo page, with MRZ (<<< lines) in view",
  pan: "Flat, filling the frame with name and number",
  voter_id: "Flat, filling the frame with EPIC number",
  driving_licence: "Front of licence with DL number and name",
  other: "Fill the frame with the card",
};

/** Explains, in the front desk's words, how this stay's dates will be billed. */
function StayRulesNote({ policy, now, walkInNight, expectedOut }: { policy: "fixed" | "24h"; now: { date: string; time: string }; walkInNight: string; expectedOut: string }) {
  const property = useCurrentProperty();
  const fd = property.frontDesk;
  let text: ReactNode = null;
  if (policy === "24h") {
    text = (
      <>
        24-hour checkout: in at {clock12(now.time)}, due out <strong>{hotelDateTimeLabel(expectedOut)}</strong>.
      </>
    );
  } else if (walkInNight < now.date) {
    text = (
      <>
        Arriving after midnight: billed from the night of <strong>{dayLabel(walkInNight)}</strong>. Arrivals before {clock12(fd.earlyArrivalCutoff)} take the night that has
        already begun (Settings).
      </>
    );
  } else if (now.time < property.checkInTime) {
    text = (
      <>
        Early check-in: standard check-in is {clock12(property.checkInTime)}. If you charge for it, add <em>Early check-in</em> on the stay page after checking in.
      </>
    );
  }
  return text ? (
    <p className="flex items-start gap-2 rounded-lg bg-sand/60 px-3 py-2 text-sm text-ink-soft sm:col-span-2" role="status">
      <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  ) : null;
}

function DocFields({
  value,
  onChange,
  errors,
  prefix,
  nationality,
  onScanned,
}: {
  value: DocForm;
  onChange: (d: DocForm) => void;
  errors: Errors;
  prefix: string;
  nationality: string;
  onScanned: (d: ScanResult, force: boolean) => string[];
}) {
  const propertyId = useCurrentProperty().id;
  const [scan, setScan] = useState<ScanState | null>(null);
  // A scan finishes after the photo step, so it must merge into the latest form values.
  const latest = useRef(value);
  latest.current = value;
  const runScan = (src: Blob | HTMLCanvasElement) => {
    const type = latest.current.type;
    if (!canScan(type)) return;
    // A good read from one side stays when the other side has nothing to read.
    const keepDone = (s: ScanState | null) => s?.state === "done" && s.type === type;
    setScan((s) => (keepDone(s) ? s : { state: "reading", type, message: `Reading the ${docTypeLabel[type]}…` }));
    scanDocument(type, src, propertyId, (message) => setScan((s) => (s?.state === "reading" && s.type === type ? { ...s, message } : s)))
      .then((details) => {
        if (latest.current.type !== type) return; // ID type changed while reading
        const nextDoc = { ...latest.current };
        if (details.number) nextDoc.number = details.number;
        if (details.expiry && type === "passport") nextDoc.visaExpiry = details.expiry;
        onChange(nextDoc);
        setScan({ state: "done", type, details, conflicts: onScanned(details, true) });
      })
      .catch((err: unknown) => {
        if (latest.current.type !== type) return;
        const message = err instanceof ScanError || err instanceof ApiError ? err.message : "Couldn't read the ID. Please type the details.";
        setScan((s) => (keepDone(s) ? s : { state: "failed", type, message }));
      });
  };
  const foreign = nationality !== "IN";
  const aadhaar = value.type === "aadhaar";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ID type" error={errors[prefix + "type"]}>
          {(id, d) => (
            <Select
              id={id}
              aria-describedby={d}
              value={value.type}
              onChange={(e) => {
                setScan(null);
                onChange({ ...value, type: e.target.value as DocType });
              }}
              invalid={!!errors[prefix + "type"]}
            >
              {(foreign ? (["passport"] as DocType[]) : (Object.keys(docTypeLabel) as DocType[])).map((t) => (
                <option key={t} value={t}>
                  {docTypeLabel[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={aadhaar ? "Aadhaar number" : `${docTypeLabel[value.type]} number`}
          optional={aadhaar}
          error={errors[prefix + "number"]}
          hint={aadhaar ? "Only the last 4 digits are kept. The full number is never stored." : "Stored encrypted."}
        >
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              className="font-mono"
              inputMode={aadhaar ? "numeric" : "text"}
              autoComplete="off"
              value={value.number}
              onChange={(e) => onChange({ ...value, number: e.target.value })}
              invalid={!!errors[prefix + "number"]}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <CameraCapture
          label="Front of ID"
          hint={scanHint[value.type]}
          facing="environment"
          value={value.front}
          onChange={(b) => onChange({ ...value, front: b })}
          error={errors[prefix + "frontUploadId"]}
          redact={aadhaar ? { instruction: "Drag a box over the first 8 digits of the Aadhaar number. Only the last 4 should stay visible. On older cards, cover the QR code too." } : undefined}
          onScan={canScan(value.type) ? runScan : undefined}
          autoQR={aadhaar}
        />
        <CameraCapture
          label="Back of ID (optional)"
          facing="environment"
          value={value.back}
          onChange={(b) => onChange({ ...value, back: b })}
          error={errors[prefix + "backUploadId"]}
          redact={aadhaar ? { instruction: "If the Aadhaar number appears on the back, cover the first 8 digits. On older cards, cover the QR code too." } : undefined}
          onScan={scanBothSides(value.type) ? runScan : undefined}
          autoQR={aadhaar}
        />
      </div>
      {scan && scan.type === value.type && (
        <ScanNote
          scan={scan}
          onUseScanned={() => {
            if (scan.state !== "done") return;
            onScanned(scan.details, true);
            setScan({ ...scan, conflicts: [] });
          }}
        />
      )}
      {foreign && (
        <div className="grid gap-4 rounded-lg bg-sand/60 p-4 sm:grid-cols-2">
          <p className="text-sm text-ink-soft sm:col-span-2">Foreign national: you'll need to file Form C within 24 hours.</p>
          <Field label="Visa number" optional>
            {(id, d) => <Input id={id} aria-describedby={d} className="font-mono" value={value.visaNumber} onChange={(e) => onChange({ ...value, visaNumber: e.target.value })} />}
          </Field>
          <Field label="Visa valid until" optional error={errors[prefix + "visaExpiry"]}>
            {(id, d) => <Input id={id} aria-describedby={d} type="date" value={value.visaExpiry} onChange={(e) => onChange({ ...value, visaExpiry: e.target.value })} />}
          </Field>
        </div>
      )}
    </div>
  );
}

export function CheckInPage() {
  const property = useCurrentProperty();
  const pid = property.id;
  const fd = property.frontDesk;
  const rooms = useRooms(pid);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Guest
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<{ state: "idle" | "loading" | "new" | "found"; guest?: Guest; docs?: GuestDocument[] }>({ state: "idle" });
  const [person, setPerson] = useState<PersonForm>(emptyPerson());
  const [photo, setPhoto] = useState<Blob | null>(null);
  // ID
  const [useDocOnFile, setUseDocOnFile] = useState(false);
  const [doc, setDoc] = useState<DocForm>(emptyDoc());
  // Companions
  const [companions, setCompanions] = useState<Companion[]>([]);
  // Aadhaar scans finish asynchronously and need the latest values.
  const personRef = useRef(person);
  personRef.current = person;
  const companionsRef = useRef(companions);
  companionsRef.current = companions;
  // Stay
  // Rooms held for another booking today aren't offered.
  const ready = useMemo(
    () => (rooms.data?.rooms ?? []).filter((r) => r.status === "ready" && (!r.reservationId || r.reservationId === params.get("reservation"))),
    [rooms.data, params],
  );
  const [roomId, setRoomId] = useState(params.get("room") ?? "");
  // Dates follow the hotel's rules (Settings → Check-in & checkout rules), mirroring backend StayNights.
  const policy = fd.checkoutPolicy;
  const now = hotelNow();
  const today = now.date;
  // A walk-in before the cutoff (say 2 AM) takes the night that has already begun.
  const walkInNight = arrivalNight(now, fd.earlyArrivalCutoff, policy);
  // Check-in happens today. A later arrival can't be checked in yet, so it's handed to Reservations as a booking.
  const [arrival, setArrival] = useState(today);
  const later = arrival > today;
  const firstNight = later ? arrival : walkInNight;
  const [stayNights, setStayNights] = useState(1);
  const setNights = (n: number) => setStayNights(Math.min(180, Math.max(1, Math.round(n) || 1)));
  const checkout = bookingAddDays(firstNight, stayNights);
  // When the guest is due out. 24-hour rule: n × 24 h from now; fixed: the checkout time on the last date.
  const expectedOut = policy === "24h" && !later ? new Date(Date.now() + stayNights * 86_400_000).toISOString() : hotelInstant(checkout, property.checkOutTime);
  // The room must be free from today until it's free for a new arrival (see backend occupiedRange).
  const outDate = hotelDateOf(expectedOut);
  const occupyTo = new Date(expectedOut).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) > property.checkInTime ? bookingAddDays(outDate, 1) : outDate;
  const [rate, setRate] = useState("");
  const [adults, setAdults] = useState("1");
  const [children, setChildren] = useState("0");
  const [comingFrom, setComingFrom] = useState("");
  const [goingTo, setGoingTo] = useState("");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  // Payment
  const [advance, setAdvance] = useState("");
  const [mode, setMode] = useState<PayMode>("upi");
  const [reference, setReference] = useState("");
  const [consent, setConsent] = useState(true);

  const [errors, setErrors] = useState<Errors>({});
  const [progress, setProgress] = useState("");

  // Arriving on a booking: carry its details into the form once.
  const reservationId = params.get("reservation");
  const booking = useReservation(pid, reservationId);
  const reservation = booking.data?.status === "booked" ? booking.data : undefined;
  const applied = useRef(false);

  // Ready rooms booked for someone else during this stay can't be given out.
  const free = useQuery({
    queryKey: ["availability", pid, today, occupyTo, reservationId ?? ""],
    queryFn: () => api<AvailableRoom[]>(`/properties/${pid}/reservations/availability?from=${today}&to=${occupyTo}&exclude=${reservationId ?? ""}`),
    enabled: !later && occupyTo > today,
    placeholderData: (prev) => prev,
  });
  const freeIds = useMemo(() => (free.data ? new Set(free.data.map((r) => r.id)) : null), [free.data]);
  const isFree = useCallback((id: string) => !freeIds || freeIds.has(id), [freeIds]);

  // Default room + rate
  useEffect(() => {
    if (roomId || reservationId) return;
    const first = ready.find((r) => isFree(r.id));
    if (first) setRoomId(first.id);
  }, [ready, roomId, reservationId, isFree]);
  const room = ready.find((r) => r.id === roomId);
  const roomTaken = !!room && !later && !isFree(room.id);
  useEffect(() => {
    if (!room) return;
    // The rate agreed at booking stands, even if the guest has to move rooms.
    setRate(String((reservation ? reservation.nightlyRate : room.baseRate) / 100));
  }, [room, reservation]);
  useEffect(() => {
    if (!reservation || applied.current || !rooms.data) return;
    applied.current = true;
    const stillReady = ready.some((r) => r.id === reservation.roomId);
    setRoomId(stillReady ? reservation.roomId : ready[0]?.id ?? "");
    setNights(reservation.checkOut > today ? nightsBetween(walkInNight, reservation.checkOut) : 1);
    setAdults(String(reservation.adults));
    setChildren(String(reservation.children));
    setConsent(reservation.whatsappConsent);
    setPhone(formatPhone(reservation.guestPhone));
    void findGuest(reservation.guestPhone, reservation.guestName);
    // findGuest only uses values passed in or stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation, rooms.data, ready]);
  useEffect(() => {
    setAdults(String(Math.max(1, 1 + companions.length)));
  }, [companions.length]);
  // Foreign guests must show a passport.
  useEffect(() => {
    if (person.nationality !== "IN" && doc.type !== "passport") setDoc((d) => ({ ...d, type: "passport" }));
  }, [person.nationality, doc.type]);

  const findGuest = async (number = phone, bookedName = "") => {
    if (number.replace(/\D/g, "").length < 10) {
      setErrors((e) => ({ ...e, "guest.phone": "Enter the guest's 10-digit mobile number." }));
      return;
    }
    setErrors((e) => ({ ...e, "guest.phone": "" }));
    setLookup({ state: "loading" });
    try {
      const r = await api<{ phone: string; guest: Guest | null; documents?: GuestDocument[] }>(
        `/properties/${pid}/guests/lookup?phone=${encodeURIComponent(number)}`,
      );
      if (r.guest) {
        const g = r.guest;
        const onFile: PersonForm = { name: g.name, nationality: g.nationality, email: g.email, address: g.address, gender: g.gender, birthYear: g.birthYear ? String(g.birthYear) : "" };
        setPerson((p) => {
          const next = { ...p };
          (Object.keys(onFile) as (keyof PersonForm)[]).forEach((k) => {
            if (!p[k].trim() || (k === "nationality" && p[k] === "IN")) next[k] = onFile[k];
          });
          return next;
        });
        setLookup({ state: "found", guest: g, docs: r.documents });
        setUseDocOnFile((r.documents?.length ?? 0) > 0);
        setConsent(true);
      } else {
        setLookup({ state: "new" });
        setUseDocOnFile(false);
        if (bookedName) setPerson((p) => (p.name.trim() ? p : { ...p, name: bookedName }));
      }
    } catch (err) {
      setLookup({ state: "idle" });
      if (err instanceof ApiError && err.fields?.phone) setErrors((e) => ({ ...e, "guest.phone": err.fields!.phone }));
    }
  };

  // Live estimate
  const nights = stayNights;

  /** Opens Reservations with a new booking prefilled from this form. */
  const bookForLater = () => {
    const q = new URLSearchParams({ new: "1", checkIn: arrival, checkOut: checkout, name: person.name.trim(), phone, adults, children });
    if (room) q.set("room", room.id);
    if (toPaise(rate) !== null) q.set("rate", rate);
    navigate(`/reservations?${q}`);
  };
  const ratePaise = toPaise(rate) ?? 0;
  const gstPct = !fd.gstRegistered ? 0 : ratePaise <= fd.roomGstThreshold ? fd.roomGstLow : fd.roomGstHigh;
  const roomTotal = Math.round(ratePaise * nights * (1 + gstPct / 100));

  const submit = useMutation({
    mutationFn: async () => {
      const clientErrors: Errors = {};
      if (phone.replace(/\D/g, "").length < 10) clientErrors["guest.phone"] = "Enter the guest's 10-digit mobile number.";
      if (!person.name.trim()) clientErrors["guest.name"] = "Enter the guest's full name.";
      if (!useDocOnFile && !doc.front) clientErrors["document.frontUploadId"] = "Take a photo of the front of the ID.";
      companions.forEach((c, i) => {
        if (!c.person.name.trim()) clientErrors[`companions.${i}.name`] = "Enter their name.";
        if (c.addId && !c.doc.front) clientErrors[`companions.${i}.document.frontUploadId`] = "Take a photo of their ID, or remove the ID.";
      });
      if (!roomId) clientErrors.roomId = "Choose a room.";
      else if (roomTaken) clientErrors.roomId = `Room ${room!.number} is booked for another guest during these dates. Choose another room or shorten the stay.`;
      if (toPaise(rate) === null) clientErrors.nightlyRate = "Enter the nightly rate.";
      if (Object.keys(clientErrors).length) throw new ApiError(422, "validation_failed", "Some fields need attention.", clientErrors);

      // Phone not looked up yet (e.g. submitted straight from the field): link a returning guest by number.
      let guestId = lookup.guest?.id ?? "";
      if (lookup.state !== "found") {
        const r = await api<{ guest: Guest | null }>(`/properties/${pid}/guests/lookup?phone=${encodeURIComponent(phone)}`);
        guestId = r.guest?.id ?? "";
      }

      const up = async (b: Blob | null, kind: "photo" | "id_front" | "id_back", label: string) => {
        if (!b) return "";
        setProgress(`Uploading ${label}…`);
        return uploadGuestImage(pid, b, kind);
      };
      const photoId = await up(photo, "photo", "guest photo");
      const docPayload = useDocOnFile
        ? null
        : {
            type: doc.type,
            number: doc.number,
            frontUploadId: await up(doc.front, "id_front", "ID front"),
            backUploadId: await up(doc.back, "id_back", "ID back"),
            visaNumber: doc.visaNumber,
            visaExpiry: doc.visaExpiry,
          };
      const comps = [];
      for (const [i, c] of companions.entries()) {
        comps.push({
          name: c.person.name,
          nationality: c.person.nationality,
          phone: "",
          email: "",
          address: "",
          gender: "",
          document: c.addId
            ? {
                type: c.doc.type,
                number: c.doc.number,
                frontUploadId: await up(c.doc.front, "id_front", `companion ${i + 1} ID`),
                backUploadId: await up(c.doc.back, "id_back", `companion ${i + 1} ID back`),
                visaNumber: c.doc.visaNumber,
                visaExpiry: c.doc.visaExpiry,
              }
            : null,
        });
      }
      setProgress("Checking in…");
      const amount = toPaise(advance) ?? 0;
      return api<StayDetail>(`/properties/${pid}/stays`, {
        method: "POST",
        body: {
          guest: {
            id: guestId,
            name: person.name,
            phone,
            email: person.email,
            nationality: person.nationality,
            gender: person.gender,
            birthYear: person.birthYear ? Number(person.birthYear) : null,
            address: person.address,
            photoUploadId: photoId,
          },
          document: docPayload,
          companions: comps,
          roomId,
          nightlyRate: toPaise(rate),
          expectedCheckOutAt: expectedOut,
          adults: Number(adults) || 1,
          children: Number(children) || 0,
          purpose,
          comingFrom,
          goingTo,
          notes,
          advance: amount > 0 ? { amount, mode, reference } : null,
          whatsappConsent: consent,
          reservationId: reservation?.id ?? "",
        },
      });
    },
    onSuccess: (stay) => {
      qc.invalidateQueries({ queryKey: ["rooms", pid] });
      qc.invalidateQueries({ queryKey: ["stays", pid] });
      qc.invalidateQueries({ queryKey: ["reservations", pid] });
      qc.invalidateQueries({ queryKey: ["reservation", pid] });
      navigate(`/stays/${stay.id}?checkedIn=1`, { replace: true });
    },
    onError: (err) => {
      setProgress("");
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        requestAnimationFrame(() => document.querySelector('[aria-invalid="true"], [role="alert"]')?.scrollIntoView({ block: "center", behavior: "smooth" }));
      }
    },
  });

  const general = submit.error && !(submit.error instanceof ApiError && submit.error.fields) ? submit.error.message : "";
  const found = lookup.state === "found";
  const phoneDigits = phone.replace(/\D/g, "");
  const nightsLabel = `${nights} ${nights === 1 ? "night" : "nights"}`;

  return (
    <>
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Today
      </Link>
      <PageHeader title="New check-in" description="A warm welcome starts with a smooth check-in. Returning guests fill in from their mobile number." />

      {reservationId && booking.data && !reservation && <div className="mb-4"><ErrorNote message="This booking has already been checked in or closed. Continue only for a new walk-in." /></div>}
      {reservation && (
        <div className="mb-4 rounded-xl border border-line bg-sand px-4 py-3 text-sm text-ink-soft" role="status">
          Checking in the booking for <strong className="text-ink">{reservation.guestName}</strong>, Room {reservation.roomNumber}.
          {reservation.advanceAmount > 0 && ` ${rupees(reservation.advanceAmount)} advance from the booking is added automatically.`}
          {rooms.data && !ready.some((r) => r.id === reservation.roomId) && (
            <span className="mt-1 block font-semibold text-accent-700">
              Room {reservation.roomNumber} isn't ready yet, so another room is selected below. Mark it ready on the Rooms page to use it, or keep the room below at the booked rate.
            </span>
          )}
        </div>
      )}

      <form
        noValidate
        className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (later) return bookForLater();
          setErrors({});
          submit.mutate();
        }}
      >
        <div className="flex min-w-0 flex-col gap-5">
            <Section
              icon={UserRound}
              title="Guest information"
              description="Start with the mobile number. A returning guest's details fill in automatically."
              aside={
                <span className="hidden items-center gap-1 text-xs font-medium text-muted sm:flex">
                  <ShieldCheck className="size-3.5" aria-hidden /> Private &amp; secure
                </span>
              }
            >
              <div className="flex flex-col gap-5">
                <Field
                  label="Mobile number"
                  error={errors["guest.phone"]}
                  hint={
                    lookup.state === "new"
                      ? "New guest: fill in their details below."
                      : "10-digit Indian mobile, or + country code for foreign numbers."
                  }
                >
                  {(id, d) => (
                    <div className="relative sm:max-w-sm">
                      <Input
                        id={id}
                        aria-describedby={d}
                        type="tel"
                        inputMode="tel"
                        autoFocus
                        placeholder="98470 12345"
                        value={phone}
                        invalid={!!errors["guest.phone"]}
                        className="pr-10"
                        onChange={(e) => {
                          const v = e.target.value;
                          setPhone(v);
                          if (lookup.state !== "idle") setLookup({ state: "idle" });
                          // Look up as soon as a full Indian number is typed.
                          if (!v.trim().startsWith("+") && v.replace(/\D/g, "").length === 10) void findGuest(v);
                        }}
                        onBlur={() => {
                          if (lookup.state === "idle" && phoneDigits.length >= 10) void findGuest();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void findGuest();
                          }
                        }}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted" aria-hidden>
                        {lookup.state === "loading" ? <Loader2 className="size-4 animate-spin" /> : found ? <BadgeCheck className="size-4 text-ready" /> : null}
                      </span>
                    </div>
                  )}
                </Field>

                {found && lookup.guest && (
                  <div className="flex items-center gap-3 rounded-lg border border-ready/20 bg-ready-bg px-4 py-3 text-sm text-ready" role="status">
                    <BadgeCheck className="size-5 shrink-0" aria-hidden />
                    <span>
                      <strong>Returning guest: {lookup.guest.name}</strong> has stayed {lookup.guest.stayCount} {lookup.guest.stayCount === 1 ? "time" : "times"} before. Check the details are still correct.
                    </span>
                  </div>
                )}

                <PersonFields value={person} onChange={setPerson} errors={errors} prefix="guest." />
                <CameraCapture
                  label="Guest photo (optional)"
                  hint="Optional: check-in can be submitted without a guest photo."
                  facing="user"
                  shape="portrait"
                  value={photo}
                  onChange={setPhoto}
                  error={errors["guest.photoUploadId"]}
                />
              </div>
            </Section>

            <Section icon={IdCard} title="ID proof" description="Scan Aadhaar, Passport, DL, Voter ID or PAN to auto-fill guest details.">
              <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/60 p-3.5 text-xs text-brand-900">
                <p className="font-semibold text-brand-800 flex items-center gap-1.5">
                  <Sparkles className="size-4 shrink-0 text-brand-700" />
                  Automatic ID Detail Extraction & Autofill
                </p>
                <p className="mt-1 leading-relaxed text-brand-900">
                  Upload or photograph front and back photos of any supported ID (Aadhaar, Passport, Driving Licence, Voter ID, or PAN). Gustlog automatically extracts the document details and auto-populates the guest's <strong>Name</strong>, <strong>ID Number</strong>, <strong>Date of Birth</strong>, <strong>Gender</strong>, and <strong>Address</strong> into the form above.
                </p>
              </div>
              {found && (lookup.docs?.length ?? 0) > 0 && (
                <div className="mb-5 flex flex-col gap-2">
                  {(
                    [
                      [true, `Use ID on file: ${docTypeLabel[lookup.docs![0].type]}${lookup.docs![0].numberLast4 ? ` ending ${lookup.docs![0].numberLast4}` : ""}`],
                      [false, "Add a new ID"],
                    ] as const
                  ).map(([v, label]) => (
                    <label key={String(v)} className={clsx("flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm", useDocOnFile === v ? "border-brand-700 bg-brand-50" : "border-line")}>
                      <input type="radio" name="docchoice" className="accent-brand-700" checked={useDocOnFile === v} onChange={() => setUseDocOnFile(v)} />
                      {label}
                    </label>
                  ))}
                </div>
              )}
              {!useDocOnFile && (
                <DocFields
                  value={doc}
                  onChange={setDoc}
                  errors={errors}
                  prefix="document."
                  nationality={person.nationality}
                  onScanned={(d, force) => {
                    const { next, conflicts } = mergeScan(personRef.current, d, force);
                    setPerson(next);
                    return conflicts;
                  }}
                />
              )}
            </Section>

            <Section
              icon={Users}
              title="Other guests in the room"
              description="Add every adult staying in the room. Police rules usually need an ID for each."
              aside={
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  icon={<Plus className="size-4" />}
                  onClick={() => setCompanions((cs) => [...cs, { key: Date.now(), person: emptyPerson(), addId: true, doc: emptyDoc() }])}
                >
                  Add person
                </Button>
              }
            >
              {companions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">Travelling alone? Skip this.</p>
              ) : (
                <div className="flex flex-col gap-6">
                  {companions.map((c, i) => {
                    const update = (patch: Partial<Companion>) => setCompanions((cs) => cs.map((x) => (x.key === c.key ? { ...x, ...patch } : x)));
                    return (
                      <div key={c.key} className="rounded-xl border border-line p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="font-semibold">Person {i + 2}</p>
                          <Button type="button" size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setCompanions((cs) => cs.filter((x) => x.key !== c.key))}>
                            Remove
                          </Button>
                        </div>
                        <PersonFields compact value={c.person} onChange={(p) => update({ person: p, doc: p.nationality !== "IN" ? { ...c.doc, type: "passport" } : c.doc })} errors={errors} prefix={`companions.${i}.`} />
                        <label className="mt-4 flex items-center gap-2 text-sm">
                          <input type="checkbox" className="size-4 accent-brand-700" checked={c.addId} onChange={(e) => update({ addId: e.target.checked })} />
                          Record their ID (needed for adults)
                        </label>
                        {c.addId && (
                          <div className="mt-4">
                            <DocFields
                              value={c.doc}
                              onChange={(d) => update({ doc: d })}
                              errors={errors}
                              prefix={`companions.${i}.document.`}
                              nationality={c.person.nationality}
                              onScanned={(d, force) => {
                                // Companions only record a name and nationality; other scanned fields aren't sent.
                                const cur = companionsRef.current.find((x) => x.key === c.key);
                                if (!cur) return [];
                                const { next, conflicts } = mergeScan(
                                  { ...emptyPerson(), name: cur.person.name, nationality: cur.person.nationality },
                                  { ...d, gender: "", birthYear: null, address: "" },
                                  force,
                                );
                                setCompanions((cs) => cs.map((x) => (x.key === c.key ? { ...x, person: { ...x.person, name: next.name, nationality: next.nationality } } : x)));
                                return conflicts;
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section icon={BedDouble} title="Room & stay" description="Only rooms marked ready are listed.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Room"
                  error={errors.roomId || (roomTaken ? `Room ${room!.number} is booked for another guest during these dates. Choose another room or shorten the stay.` : undefined)}
                  className="sm:col-span-2"
                >
                  {(id, d) =>
                    ready.length === 0 ? (
                      <p id={id} className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
                        No rooms are ready. Mark a room ready on the Rooms page first.
                      </p>
                    ) : (
                      <Select id={id} aria-describedby={d} value={roomId} onChange={(e) => setRoomId(e.target.value)} invalid={!!errors.roomId}>
                        {ready.map((r) => (
                          <option key={r.id} value={r.id} disabled={!later && !isFree(r.id) && r.id !== roomId}>
                            Room {r.number} · {r.typeName} · {r.bedType} · {rupees(r.baseRate)}
                            {!later && !isFree(r.id) ? " · booked during these dates" : ""}
                          </option>
                        ))}
                      </Select>
                    )
                  }
                </Field>
                <Field label="Check-in date" hint={later ? "Future date: this will be a booking" : `Now, ${clock12(now.time)}`}>
                  {(id, d) => (
                    <Input
                      id={id}
                      aria-describedby={d}
                      type="date"
                      min={today}
                      // A booking being checked in starts now, whatever date it was booked for.
                      disabled={!!reservation}
                      value={arrival}
                      onChange={(e) => {
                        const v = e.target.value || today;
                        setArrival(v < today ? today : v);
                      }}
                    />
                  )}
                </Field>
                {policy === "24h" && !later ? (
                  <Field label="Nights (24 hours each)" error={errors.expectedCheckOutAt} hint={`Due out ${hotelDateTimeLabel(expectedOut)}`}>
                    {(id) => <Stepper id={id} label="nights" min={1} value={stayNights} onChange={setNights} />}
                  </Field>
                ) : (
                  <Field
                    label="Checkout date"
                    error={errors.expectedCheckOutAt}
                    hint={`${stayNights} ${stayNights === 1 ? "night" : "nights"} · leave by ${clock12(property.checkOutTime)}`}
                  >
                    {(id, d) => (
                      <Input
                        id={id}
                        aria-describedby={d}
                        type="date"
                        min={bookingAddDays(firstNight, 1)}
                        max={bookingAddDays(firstNight, 180)}
                        value={checkout}
                        onChange={(e) => e.target.value && setNights(nightsBetween(firstNight, e.target.value))}
                        invalid={!!errors.expectedCheckOutAt}
                      />
                    )}
                  </Field>
                )}
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2" role="group" aria-label="Length of stay">
                  <span className="text-sm text-muted">Stay:</span>
                  {[1, 2, 3, 7].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNights(n)}
                      className={clsx(
                        "rounded-full border px-3 py-1 text-sm font-medium",
                        stayNights === n ? "border-brand-700 bg-brand-50 text-brand-800" : "border-line text-ink-soft hover:border-line-strong",
                      )}
                    >
                      {n === 7 ? "1 week" : `${n} night${n === 1 ? "" : "s"}`}
                    </button>
                  ))}
                </div>
                {!later && <StayRulesNote policy={policy} now={now} walkInNight={walkInNight} expectedOut={expectedOut} />}
                {later && (
                  <div className="rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm sm:col-span-2" role="status">
                    <p>
                      The guest arrives on <strong>{dayLabel(arrival)}</strong>, so they can't be checked in today. Save the stay as a booking; it holds the room, and you check them in from Reservations when they arrive.
                    </p>
                    <Button type="button" size="sm" className="mt-3" icon={<CalendarPlus className="size-4" />} onClick={bookForLater}>
                      Book {dayLabel(arrival)} – {dayLabel(checkout)} ({stayNights} {stayNights === 1 ? "night" : "nights"})
                    </Button>
                  </div>
                )}
                <Field label="Rate per night (before GST)" error={errors.nightlyRate}>
                  {(id, d) => (
                    <Input
                      id={id}
                      aria-describedby={d}
                      prefix="₹"
                      inputMode="decimal"
                      value={rate}
                      onChange={(e) => {
                        setRate(e.target.value);
                        if (errors.nightlyRate) setErrors((x) => ({ ...x, nightlyRate: "" }));
                      }}
                      invalid={!!errors.nightlyRate}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-x-6 gap-y-4 sm:col-span-2">
                  <Field label="Adults" error={errors.adults}>
                    {(id) => <Stepper id={id} label="adults" min={1} value={Number(adults) || 1} onChange={(n) => setAdults(String(n))} />}
                  </Field>
                  <Field label="Children" error={errors.children}>
                    {(id) => <Stepper id={id} label="children" min={0} value={Number(children) || 0} onChange={(n) => setChildren(String(n))} />}
                  </Field>
                </div>
              </div>
              <Disclosure summary="Arriving from, purpose, notes (optional)" className="mt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Arriving from" optional>{(id, d) => <Input id={id} aria-describedby={d} value={comingFrom} onChange={(e) => setComingFrom(e.target.value)} />}</Field>
                  <Field label="Going to next" optional>{(id, d) => <Input id={id} aria-describedby={d} value={goingTo} onChange={(e) => setGoingTo(e.target.value)} />}</Field>
                  <Field label="Purpose of visit" optional>
                    {(id, d) => (
                      <Select id={id} aria-describedby={d} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                        <option value="">—</option>
                        <option>Tourism</option>
                        <option>Business</option>
                        <option>Family / personal</option>
                        <option>Medical</option>
                        <option>Other</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Notes" optional className="sm:col-span-2">{(id, d) => <Textarea id={id} aria-describedby={d} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
                </div>
              </Disclosure>
              <div className="mt-5 flex items-center justify-between rounded-lg bg-sand/60 px-4 py-3 text-sm">
                <span className="text-ink-soft">
                  Estimated room charge ({nights} × {rupees(ratePaise)}
                  {gstPct > 0 ? ` + ${gstPct}% GST` : ""})
                </span>
                <span className="tabular font-display text-lg font-bold">{rupees(roomTotal)}</span>
              </div>
            </Section>

            <Section icon={Wallet} title="Advance payment" description="Anything collected now is recorded against the bill.">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={reservation?.advanceAmount ? "Extra amount received now" : "Amount received"} optional error={errors["advance.amount"]}>
                  {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" placeholder="0" value={advance} onChange={(e) => setAdvance(e.target.value)} />}
                </Field>
                <Field label="Method" error={errors["advance.mode"]}>
                  {(id, d) => (
                    <Select id={id} aria-describedby={d} value={mode} onChange={(e) => setMode(e.target.value as PayMode)}>
                      <option value="upi">UPI</option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank">Bank transfer</option>
                      <option value="other">Other</option>
                    </Select>
                  )}
                </Field>
                <Field label="Reference / UTR" optional>
                  {(id, d) => <Input id={id} aria-describedby={d} className="font-mono" value={reference} onChange={(e) => setReference(e.target.value)} />}
                </Field>
              </div>
            </Section>

            <Card className="px-5 py-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span className="text-sm">
                  <span className="font-semibold">Guest agrees to receive WhatsApp messages</span>
                  <span className="block text-muted">
                    Welcome details, their bill, and a feedback request{phone ? ` on ${formatPhone(phone.startsWith("+") ? phone : "+91" + phone.replace(/\D/g, "").slice(-10))}` : ""}.
                  </span>
                </span>
              </label>
            </Card>

            {general && <ErrorNote message={general} />}
            {Object.values(errors).some(Boolean) && (
              <p className="text-sm text-danger" role="alert">
                Some fields above need attention.
              </p>
            )}
            {/* Spacer so the fixed bar never covers the last section (phones/tablets) */}
            <div className="h-20 lg:hidden" aria-hidden />
        </div>

        {/* Desktop: sticky summary with the primary action */}
        <aside className="sticky top-24 hidden lg:block">
          <Card className="p-5">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">Stay summary</p>
            <dl className="mt-4 flex flex-col gap-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Guest</dt>
                <dd className="truncate font-medium">{person.name.trim() || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Room</dt>
                <dd className="font-medium">{room ? `${room.number} · ${room.typeName}` : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Stay</dt>
                <dd className="font-medium">{nightsLabel}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Guests</dt>
                <dd className="font-medium">{1 + companions.length}</dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-xs text-muted">Estimated room charge{gstPct > 0 ? ` incl. ${gstPct}% GST` : ""}</p>
              <p className="tabular font-display text-2xl font-bold">{rupees(roomTotal)}</p>
            </div>
            <Button type="submit" className="mt-4 w-full" loading={submit.isPending} disabled={ready.length === 0}>
              Check in{room ? ` to ${room.number}` : ""}
            </Button>
            {progress && <p className="mt-2 text-center text-xs text-muted">{progress}</p>}
            <Link to="/" className="mt-2 block text-center text-sm font-medium text-muted hover:text-ink">
              Cancel
            </Link>
          </Card>
        </aside>

            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgb(36_36_36/0.18)] backdrop-blur lg:hidden">
              <div className="mx-auto flex max-w-6xl items-center justify-end gap-3">
              {progress ? (
                <span className="mr-auto min-w-0 truncate text-sm text-muted">{progress}</span>
              ) : (
                room && (
                  <span className="mr-auto min-w-0">
                    <span className="tabular block font-display text-lg leading-tight font-bold">{rupees(roomTotal)}</span>
                    <span className="block truncate text-xs text-muted">
                      Room {room.number} · {nightsLabel} · out {hotelDateTimeLabel(expectedOut)}
                    </span>
                  </span>
                )
              )}
              {/* On phones the "Today" link at the top is the way back. */}
              <Link to="/" className="hidden sm:block">
                <Button type="button" variant="secondary">Cancel</Button>
              </Link>
              {later ? (
                <Button type="button" icon={<CalendarPlus className="size-4" />} onClick={bookForLater}>
                  Create booking
                </Button>
              ) : (
                <Button type="submit" loading={submit.isPending} disabled={ready.length === 0}>
                  Check in{room ? ` to ${room.number}` : ""}
                </Button>
              )}
              </div>
            </div>
      </form>
    </>
  );
}
