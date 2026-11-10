import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, BadgeCheck, Loader2, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CameraCapture } from "../components/CameraCapture";
import { Button, Card, Disclosure, ErrorNote, Field, Input, Select, Stepper, Textarea } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { clock12, rupees, toPaise } from "../lib/format";
import { useCurrentProperty } from "../lib/property";
import { addDays as bookingAddDays, hotelToday, useReservation } from "../lib/reservations";
import { useRooms } from "../lib/rooms";
import {
  COUNTRIES,
  docTypeLabel,
  formatPhone,
  scanAadhaar,
  uploadGuestImage,
  type AadhaarDetails,
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

function Section({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-sm font-bold text-ivory">{n}</span>
        <h2 className="flex-1 font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="px-5 py-5">{children}</div>
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

/** Fills empty fields from an Aadhaar scan. Differing values are kept unless forced, and reported as conflicts. */
function mergeScan(p: PersonForm, d: AadhaarDetails, force: boolean): { next: PersonForm; conflicts: string[] } {
  const next = { ...p };
  const conflicts: string[] = [];
  const fields: [keyof PersonForm, string, string][] = [
    ["name", d.name, "name"],
    ["gender", d.gender, "gender"],
    ["birthYear", d.birthYear ? String(d.birthYear) : "", "year of birth"],
    ["address", d.address, "address"],
  ];
  for (const [key, scanned, label] of fields) {
    if (!scanned) continue;
    const current = p[key].trim();
    if (!current || force) next[key] = scanned;
    else if (current.toLowerCase() !== scanned.toLowerCase()) conflicts.push(label);
  }
  return { next, conflicts };
}

type ScanState =
  | { state: "reading" }
  | { state: "done"; details: AadhaarDetails; conflicts: string[] }
  | { state: "failed"; message: string };

function ScanNote({ scan, onUseAadhaar }: { scan: ScanState; onUseAadhaar: () => void }) {
  if (scan.state === "reading") {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-sand/60 px-3 py-2 text-sm text-ink-soft" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Reading Aadhaar…
      </p>
    );
  }
  if (scan.state === "failed") {
    return (
      <p className="rounded-lg bg-marigold-50 px-3 py-2 text-sm text-marigold-700" role="status">
        {scan.message}
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800" role="status">
      <p className="flex items-center gap-2 font-medium">
        <BadgeCheck className="size-4 shrink-0" aria-hidden /> Filled from Aadhaar, please check the details.
      </p>
      {scan.conflicts.length > 0 && (
        <p className="mt-1">
          Aadhaar shows a different {scan.conflicts.join(", ")}.{" "}
          <button type="button" className="font-semibold underline" onClick={onUseAadhaar}>
            Use Aadhaar details
          </button>
        </p>
      )}
    </div>
  );
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
  onScanned: (d: AadhaarDetails, force: boolean) => string[];
}) {
  const propertyId = useCurrentProperty().id;
  const [scan, setScan] = useState<ScanState | null>(null);
  // A scan finishes after the photo step, so it must merge into the latest form values.
  const latest = useRef(value);
  latest.current = value;
  const runScan = (b: Blob) => {
    setScan((s) => (s?.state === "done" ? s : { state: "reading" }));
    scanAadhaar(propertyId, b)
      .then((details) => {
        if (details.last4 && !latest.current.number.trim()) onChange({ ...latest.current, number: details.last4 });
        setScan({ state: "done", details, conflicts: onScanned(details, false) });
      })
      .catch((err: unknown) => {
        // The QR is on only one side of many cards, so a miss must not undo a good scan.
        setScan((s) => (s?.state === "done" ? s : { state: "failed", message: err instanceof Error ? err.message : "Couldn't read the QR code. Please type the details." }));
      });
  };
  const foreign = nationality !== "IN";
  const aadhaar = value.type === "aadhaar";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ID type" error={errors[prefix + "type"]}>
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value as DocType })} invalid={!!errors[prefix + "type"]}>
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
          hint={value.type === "aadhaar" ? "Keep the QR code sharp to auto-fill" : "Fill the frame with the card"}
          facing="environment"
          value={value.front}
          onChange={(b) => onChange({ ...value, front: b })}
          error={errors[prefix + "frontUploadId"]}
          redact={aadhaar ? { instruction: "Drag a box over the first 8 digits of the Aadhaar number. Only the last 4 should stay visible. On older cards, cover the QR code too." } : undefined}
          onScan={aadhaar ? runScan : undefined}
        />
        <CameraCapture
          label="Back of ID (optional)"
          facing="environment"
          value={value.back}
          onChange={(b) => onChange({ ...value, back: b })}
          error={errors[prefix + "backUploadId"]}
          redact={aadhaar ? { instruction: "If the Aadhaar number appears on the back, cover the first 8 digits. On older cards, cover the QR code too." } : undefined}
          onScan={aadhaar ? runScan : undefined}
        />
      </div>
      {aadhaar && scan && (
        <ScanNote
          scan={scan}
          onUseAadhaar={() => {
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
  const today = hotelToday();
  const tomorrow = bookingAddDays(today, 1);
  const [checkout, setCheckout] = useState(tomorrow);
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

  // Default room + rate
  useEffect(() => {
    if (!roomId && ready[0] && !reservationId) setRoomId(ready[0].id);
  }, [ready, roomId, reservationId]);
  const room = ready.find((r) => r.id === roomId);
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
    setCheckout(reservation.checkOut > today ? reservation.checkOut : tomorrow);
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
        setPerson({ name: g.name, nationality: g.nationality, email: g.email, address: g.address, gender: g.gender, birthYear: g.birthYear ? String(g.birthYear) : "" });
        setLookup({ state: "found", guest: g, docs: r.documents });
        setUseDocOnFile((r.documents?.length ?? 0) > 0);
        setConsent(true);
      } else {
        setLookup({ state: "new" });
        setUseDocOnFile(false);
        if (bookedName) setPerson((p) => ({ ...p, name: bookedName }));
      }
    } catch (err) {
      setLookup({ state: "idle" });
      if (err instanceof ApiError && err.fields?.phone) setErrors((e) => ({ ...e, "guest.phone": err.fields!.phone }));
    }
  };

  // Live estimate
  const nights = nightsBetween(today, checkout);
  const ratePaise = toPaise(rate) ?? 0;
  const gstPct = !fd.gstRegistered ? 0 : ratePaise <= fd.roomGstThreshold ? fd.roomGstLow : fd.roomGstHigh;
  const roomTotal = Math.round(ratePaise * nights * (1 + gstPct / 100));

  const submit = useMutation({
    mutationFn: async () => {
      const clientErrors: Errors = {};
      if (lookup.state === "idle" || lookup.state === "loading") clientErrors["guest.phone"] = "Look up the guest's phone number first.";
      if (!person.name.trim()) clientErrors["guest.name"] = "Enter the guest's full name.";
      if (!useDocOnFile && !doc.front) clientErrors["document.frontUploadId"] = "Take a photo of the front of the ID.";
      companions.forEach((c, i) => {
        if (!c.person.name.trim()) clientErrors[`companions.${i}.name`] = "Enter their name.";
        if (c.addId && !c.doc.front) clientErrors[`companions.${i}.document.frontUploadId`] = "Take a photo of their ID, or remove the ID.";
      });
      if (!roomId) clientErrors.roomId = "Choose a room.";
      if (toPaise(rate) === null) clientErrors.nightlyRate = "Enter the nightly rate.";
      if (Object.keys(clientErrors).length) throw new ApiError(422, "validation_failed", "Some fields need attention.", clientErrors);

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
      const [hh, mm] = property.checkOutTime.split(":");
      const expected = new Date(`${checkout}T${hh}:${mm}:00`);
      const amount = toPaise(advance) ?? 0;
      return api<StayDetail>(`/properties/${pid}/stays`, {
        method: "POST",
        body: {
          guest: {
            id: lookup.guest?.id ?? "",
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
          expectedCheckOutAt: expected.toISOString(),
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
  const showDetails = lookup.state === "new" || found;

  return (
    <>
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Today
      </Link>
      <header className="mb-6">
        <h1 className="font-display text-[28px] leading-tight font-semibold tracking-tight">New check-in</h1>
        <p className="mt-1 text-[15px] text-muted">Start with the guest's mobile number. Returning guests fill in automatically.</p>
      </header>

      {reservationId && booking.data && !reservation && <div className="mb-4"><ErrorNote message="This booking has already been checked in or closed. Continue only for a new walk-in." /></div>}
      {reservation && (
        <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800" role="status">
          Checking in the booking for <strong>{reservation.guestName}</strong>, Room {reservation.roomNumber}.
          {reservation.advanceAmount > 0 && ` ${rupees(reservation.advanceAmount)} advance from the booking is added automatically.`}
          {rooms.data && !ready.some((r) => r.id === reservation.roomId) && (
            <span className="mt-1 block font-semibold text-marigold-700">
              Room {reservation.roomNumber} isn't ready yet, so another room is selected below. Mark it ready on the Rooms page to use it, or keep the room below at the booked rate.
            </span>
          )}
        </div>
      )}

      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          submit.mutate();
        }}
      >
        <Section n={1} title="Guest" aside={found && <span className="flex items-center gap-1 text-sm font-semibold text-ready"><BadgeCheck className="size-4" /> Returning guest</span>}>
          <div className="flex flex-col gap-5">
            <Field label="Mobile number" error={errors["guest.phone"]} hint="10-digit Indian mobile, or + country code for foreign numbers.">
              {(id, d) => (
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                  <Input
                    id={id}
                    aria-describedby={d}
                    type="tel"
                    inputMode="tel"
                    autoFocus
                    placeholder="98470 12345"
                    value={phone}
                    invalid={!!errors["guest.phone"]}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      if (lookup.state !== "idle") setLookup({ state: "idle" });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void findGuest();
                      }
                    }}
                  />
                  </div>
                  <Button type="button" variant="secondary" icon={<Search className="size-4" />} loading={lookup.state === "loading"} onClick={() => findGuest()}>
                Find
              </Button>
                </div>
              )}
            </Field>

            {found && lookup.guest && (
              <div className="flex items-center gap-3 rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-800">
                <UserRound className="size-5 shrink-0" aria-hidden />
                <span>
                  <strong>{lookup.guest.name}</strong> has stayed {lookup.guest.stayCount} {lookup.guest.stayCount === 1 ? "time" : "times"} before. Details are filled
                  in; check they're still correct.
                </span>
              </div>
            )}
          </div>
        </Section>

        {showDetails && (
          <>
            <Section n={2} title="ID proof">
              {found && (lookup.docs?.length ?? 0) > 0 && (
                <div className="mb-5 flex flex-col gap-2">
                  {(
                    [
                      [true, `Use ID on file: ${docTypeLabel[lookup.docs![0].type]}${lookup.docs![0].numberLast4 ? ` ending ${lookup.docs![0].numberLast4}` : ""}`],
                      [false, "Add a new ID"],
                    ] as const
                  ).map(([v, label]) => (
                    <label key={String(v)} className={clsx("flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm", useDocOnFile === v ? "border-teal-700 bg-teal-50" : "border-line")}>
                      <input type="radio" name="docchoice" className="accent-teal-700" checked={useDocOnFile === v} onChange={() => setUseDocOnFile(v)} />
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

            <Section n={3} title="Guest details">
              <div className="flex flex-col gap-5">
                <PersonFields value={person} onChange={setPerson} errors={errors} prefix="guest." />
                <CameraCapture
                  label={found && lookup.guest?.hasPhoto ? "New guest photo (optional, a photo is on file)" : "Guest photo (recommended)"}
                  facing="user"
                  shape="portrait"
                  value={photo}
                  onChange={setPhoto}
                  error={errors["guest.photoUploadId"]}
                />
              </div>
            </Section>

            <Section
              n={4}
              title="Other guests in the room"
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
                <p className="text-sm text-muted">Travelling alone? Skip this. Add every adult staying in the room; police rules usually need an ID for each.</p>
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
                          <input type="checkbox" className="size-4 accent-teal-700" checked={c.addId} onChange={(e) => update({ addId: e.target.checked })} />
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
                                // Companions only record a name; other scanned fields aren't sent.
                                const cur = companionsRef.current.find((x) => x.key === c.key);
                                if (!cur) return [];
                                const { next, conflicts } = mergeScan({ ...emptyPerson(), name: cur.person.name }, { ...d, gender: "", birthYear: null, address: "" }, force);
                                setCompanions((cs) => cs.map((x) => (x.key === c.key ? { ...x, person: { ...x.person, name: next.name } } : x)));
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

            <Section n={5} title="Room & stay">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Room" error={errors.roomId} className="sm:col-span-2">
                  {(id, d) =>
                    ready.length === 0 ? (
                      <p id={id} className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
                        No rooms are ready. Mark a room ready on the Rooms page first.
                      </p>
                    ) : (
                      <Select id={id} aria-describedby={d} value={roomId} onChange={(e) => setRoomId(e.target.value)} invalid={!!errors.roomId}>
                        {ready.map((r) => (
                          <option key={r.id} value={r.id}>
                            Room {r.number} · {r.typeName} · {r.bedType} · {rupees(r.baseRate)}
                          </option>
                        ))}
                      </Select>
                    )
                  }
                </Field>
                <Field label="Checkout date" error={errors.expectedCheckOutAt} hint={`${nights} ${nights === 1 ? "night" : "nights"} · checkout at ${clock12(property.checkOutTime)}`}>
                  {(id, d) => (
                    <Input id={id} aria-describedby={d} type="date" min={tomorrow} value={checkout} onChange={(e) => setCheckout(e.target.value)} invalid={!!errors.expectedCheckOutAt} />
                  )}
                </Field>
                <Field label="Rate per night (before GST)" error={errors.nightlyRate}>
                  {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} invalid={!!errors.nightlyRate} />}
                </Field>
                <div className="flex gap-6 sm:col-span-2">
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
                <span className="tabular font-display text-lg font-semibold">{rupees(roomTotal)}</span>
              </div>
            </Section>

            <Section n={6} title="Advance payment">
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
                <input type="checkbox" className="mt-0.5 size-4 accent-teal-700" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
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
            {/* Spacer so the fixed bar never covers the last section */}
            <div className="h-20" aria-hidden />
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgb(26_36_35/0.18)] backdrop-blur lg:left-[248px]">
              <div className="mx-auto flex max-w-6xl items-center justify-end gap-3 lg:px-6">
              {progress ? (
                <span className="mr-auto min-w-0 truncate text-sm text-muted">{progress}</span>
              ) : (
                room && (
                  <span className="mr-auto min-w-0">
                    <span className="tabular block font-display text-lg leading-tight font-semibold">{rupees(roomTotal)}</span>
                    <span className="block truncate text-xs text-muted">
                      Room {room.number} · {nights} {nights === 1 ? "night" : "nights"}
                    </span>
                  </span>
                )
              )}
              {/* On phones the "Today" link at the top is the way back. */}
              <Link to="/" className="hidden sm:block">
                <Button type="button" variant="secondary">Cancel</Button>
              </Link>
              <Button type="submit" loading={submit.isPending} disabled={ready.length === 0}>
                Check in{room ? ` to ${room.number}` : ""}
              </Button>
              </div>
            </div>
          </>
        )}
      </form>
    </>
  );
}
