import { hotelToday } from "../lib/reservations";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, BedDouble, CalendarPlus, Check, CheckCircle2, Eye, FileText, IdCard, LogOut, MessageCircle, Phone, Plus, Trash2, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { WhatsAppSend, messageTitle } from "../components/WhatsAppSend";
import { Button, Card, Disclosure, ErrorNote, Field, Input, Select, Sheet, Spinner, Stepper, Textarea } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { canManage, useAuth } from "../lib/auth";
import { clock12, rupees, toPaise } from "../lib/format";
import { addDays, hotelDateOf, hotelDateTimeLabel, hotelInstant, nightsBetween } from "../lib/reservations";
import { useCurrentProperty } from "../lib/property";
import {
  COUNTRIES,
  docTypeLabel,
  foodPlanLabel,
  formatDateTime,
  formatDay,
  formatPhone,
  loadSecureImage,
  payModeLabel,
  useStay,
  type Bill,
  type FoodPlan,
  type GuestDocument,
  type PayMode,
  type StayDetail,
} from "../lib/stays";

const countryName = (c: string) => COUNTRIES.find(([k]) => k === c)?.[1] ?? c;

/** Loads an encrypted image only when asked (every view of an ID is logged). */
export function SecureImage({ path, alt, className, auto }: { path: string; alt: string; className?: string; auto?: boolean }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">(auto ? "loading" : "idle");
  useEffect(() => {
    if (state !== "loading") return;
    let u = "";
    let cancelled = false;
    loadSecureImage(path)
      .then((x) => {
        u = x;
        if (cancelled) URL.revokeObjectURL(x);
        else {
          setUrl(x);
          setState("idle");
        }
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [state, path]);

  if (url) return <img src={url} alt={alt} className={className} />;
  return (
    <button
      type="button"
      onClick={() => setState("loading")}
      className={clsx("flex flex-col items-center justify-center gap-1 bg-sand text-xs text-muted hover:bg-sand/70", className)}
    >
      {state === "loading" ? "Loading…" : state === "error" ? "Couldn't load. Tap to retry." : (
        <>
          <Eye className="size-4" aria-hidden /> Tap to view
        </>
      )}
    </button>
  );
}

function BillTable({ bill }: { bill: Bill }) {
  return (
    <div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {bill.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-2.5 pr-3">
                {l.description}
                {l.quantity > 1 && !l.chargeId ? null : l.quantity > 1 && <span className="text-muted"> × {l.quantity}</span>}
                {l.gstRateBp > 0 && <span className="block text-xs text-muted">GST {l.gstRateBp / 100}% · {rupees(l.taxable)} + {rupees(l.cgst + l.sgst)}</span>}
              </td>
              <td className="tabular py-2.5 text-right font-medium">{rupees(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-2 space-y-1 border-t border-line pt-3 text-sm">
        {bill.cgst > 0 && (
          <div className="flex justify-between text-muted">
            <dt>CGST + SGST</dt>
            <dd className="tabular">
              {rupees(bill.cgst)} + {rupees(bill.sgst)}
            </dd>
          </div>
        )}
        <div className="flex justify-between font-semibold">
          <dt>Total{bill.estimate ? " (estimate)" : ""}</dt>
          <dd className="tabular">{rupees(bill.total)}</dd>
        </div>
        <div className="flex justify-between text-muted">
          <dt>Paid</dt>
          <dd className="tabular">{rupees(bill.paid)}</dd>
        </div>
        <div className={clsx("flex justify-between text-base font-semibold", bill.balance > 0 ? "text-danger" : bill.balance < 0 ? "text-accent-700" : "text-ready")}>
          <dt>{bill.balance > 0 ? "Balance due" : bill.balance < 0 ? "Paid extra (refund due)" : "Settled"}</dt>
          <dd className="tabular">{rupees(Math.abs(bill.balance))}</dd>
        </div>
      </dl>
    </div>
  );
}

export function StayPage() {
  const { stayId = "" } = useParams();
  const property = useCurrentProperty();
  const pid = property.id;
  const q = useStay(pid, stayId);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const justCheckedIn = params.get("checkedIn") === "1";
  const [sheet, setSheet] = useState<"welcome" | "charge" | "payment" | "checkout" | "edit" | "billing" | null>(null);

  // Offer the welcome message once, right after check-in.
  const offeredWelcome = useRef(false);
  useEffect(() => {
    const d = q.data;
    if (!justCheckedIn || offeredWelcome.current || !d || d.status !== "in_house") return;
    offeredWelcome.current = true;
    if (d.guest.whatsappConsent && d.guest.phone && !d.messages.length) setSheet("welcome");
  }, [justCheckedIn, q.data]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const inHouse = s.status === "in_house";
  const overdue = inHouse && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(s.expectedCheckOutAt)) < hotelToday();
  const welcomeSent = s.messages.some((m) => m.kind === "welcome" && m.status === "sent");

  return (
    <>
      <Link to={inHouse ? "/" : "/guests"} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {inHouse ? "Today" : "Guests"}
      </Link>

      {justCheckedIn && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-ready/30 bg-ready-bg px-4 py-3 text-sm text-ready" role="status">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          <span className="flex-1">
            <strong>{s.guestName}</strong> is checked in to room {s.roomNumber}.
          </span>
          <button className="text-xs font-semibold underline" onClick={() => setParams({}, { replace: true })}>
            Dismiss
          </button>
        </div>
      )}

      <header className="mb-6 flex flex-wrap items-start gap-4">
        <div className="tabular surface flex size-14 shrink-0 items-center justify-center font-display text-xl font-bold" aria-label={`Room ${s.roomNumber}`}>
          {s.roomNumber}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[26px] leading-tight font-bold tracking-tight">{s.guestName}</h1>
            <span
              className={clsx(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                overdue ? "bg-danger-bg text-danger" : inHouse ? "bg-occupied-bg text-occupied" : s.status === "checked_out" ? "bg-sand text-ink-soft" : "bg-danger-bg text-danger",
              )}
            >
              {overdue ? "Overdue" : inHouse ? "In-house" : s.status === "checked_out" ? "Checked out" : "Cancelled"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            {s.roomType} · {s.adults} {s.adults === 1 ? "adult" : "adults"}
            {s.children > 0 && ` · ${s.children} ${s.children === 1 ? "child" : "children"}`} · In {formatDateTime(s.checkInAt)} ·{" "}
            {s.checkedOutAt ? `Out ${formatDateTime(s.checkedOutAt)}` : `Due out ${formatDay(s.expectedCheckOutAt)}`}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button variant="secondary" icon={<MessageCircle className="size-4" />} onClick={() => setSheet("welcome")}>
            {welcomeSent ? "Resend welcome" : "Send welcome"}
          </Button>
          {inHouse && (
            <Button icon={<LogOut className="size-4" />} onClick={() => setSheet("checkout")}>
              Check out
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-5">
          <GuestCard stay={s} />
          {s.companions.length > 0 && (
            <Card className="px-5 py-4">
              <h2 className="mb-3 font-semibold">Also in the room</h2>
              <ul className="flex flex-col gap-2">
                {s.companions.map((c) => (
                  <li key={c.id}>
                    <Link to={`/guests/${c.id}`} className="text-sm font-medium text-ink underline-offset-2 hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-sm text-muted"> · {countryName(c.nationality)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="px-5 py-4">
            <h2 className="mb-3 font-semibold">Messages</h2>
            {s.messages.length === 0 ? (
              <p className="text-sm text-muted">No WhatsApp messages sent yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {s.messages.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {m.status === "sent" ? <Check className="size-4 text-ready" aria-hidden /> : <span className="size-4 text-center text-muted">–</span>}
                    <span className="flex-1">
                      {messageTitle[m.kind] ?? m.kind} {m.status === "sent" ? "sent" : "not sent"}
                      <span className="text-muted"> · {m.userName}</span>
                    </span>
                    <span className="text-xs text-muted">{formatDateTime(m.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 className="font-semibold">Bill</h2>
            <div className="flex flex-wrap gap-2">
              {s.status === "checked_out" && (
                <Button size="sm" variant="secondary" icon={<FileText className="size-4" />} onClick={() => navigate(`/stays/${s.id}/invoice`)}>
                  {s.invoiceNumber ? `Invoice ${s.invoiceNumber}` : "Create invoice"}
                </Button>
              )}
              {inHouse && (
                <>
                  <Button size="sm" variant="ghost" icon={<FileText className="size-4" />} onClick={() => setSheet("billing")}>
                    Billing details
                  </Button>
                  <Button size="sm" variant="ghost" icon={<CalendarPlus className="size-4" />} onClick={() => setSheet("edit")}>
                    Extend / edit
                  </Button>
                  <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setSheet("charge")}>
                    Add service
                  </Button>
                </>
              )}
              {(inHouse || s.bill.balance > 0) && (
                <Button size="sm" variant="secondary" icon={<Wallet className="size-4" />} onClick={() => setSheet("payment")}>
                  Record payment
                </Button>
              )}
            </div>
          </div>
          <div className="px-5 py-4">
            <BillTable bill={s.bill} />
            {inHouse && s.charges.length > 0 && <ChargeList stay={s} />}
            <h3 className="mt-6 mb-2 text-sm font-semibold text-ink-soft">Payments</h3>
            {s.payments.length === 0 ? (
              <p className="text-sm text-muted">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {s.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {p.amount < 0 ? "Refund" : p.isAdvance ? "Advance" : "Payment"} · {payModeLabel[p.mode]}
                      {p.reference && <span className="font-mono text-xs text-muted"> {p.reference}</span>}
                      <span className="block text-xs text-muted">
                        {formatDateTime(p.createdAt)}
                        {p.receivedBy && ` · ${p.receivedBy}`}
                      </span>
                    </span>
                    <span className={clsx("tabular font-semibold", p.amount < 0 && "text-accent-700")}>{p.amount < 0 ? `−${rupees(-p.amount)}` : rupees(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <WhatsAppSend propertyId={pid} stayId={s.id} kind="welcome" open={sheet === "welcome"} onClose={() => setSheet(null)} />
      {sheet === "charge" && <ChargeSheet stay={s} onClose={() => setSheet(null)} />}
      {sheet === "payment" && <PaymentSheet stay={s} onClose={() => setSheet(null)} />}
      {sheet === "billing" && <BillingSheet stay={s} onClose={() => setSheet(null)} />}
      {sheet === "edit" && <EditStaySheet stay={s} onClose={() => setSheet(null)} />}
      {sheet === "checkout" && <CheckoutSheet stay={s} onClose={() => setSheet(null)} />}
    </>
  );
}

function GuestCard({ stay: s }: { stay: StayDetail }) {
  const property = useCurrentProperty();
  const g = s.guest;
  const base = `/properties/${property.id}/guests/${g.id}`;
  return (
    <Card className="px-5 py-4">
      <div className="flex gap-4">
        <div className="size-20 shrink-0 overflow-hidden rounded-xl border border-line">
          {g.hasPhoto ? (
            <SecureImage path={`${base}/photo`} alt={`${g.name}'s photo`} className="size-full object-cover" auto />
          ) : (
            <div className="flex size-full items-center justify-center bg-sand text-xs text-muted">No photo</div>
          )}
        </div>
        <div className="min-w-0 text-sm">
          <Link to={`/guests/${g.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
            {g.name}
          </Link>
          {g.phone && (
            <a href={`tel:${g.phone}`} className="mt-1 flex items-center gap-1.5 text-ink-soft hover:text-ink">
              <Phone className="size-3.5" aria-hidden /> {formatPhone(g.phone)}
            </a>
          )}
          <p className="mt-1 text-muted">
            {countryName(g.nationality)}
            {g.stayCount > 1 && ` · ${g.stayCount} stays`}
          </p>
          {g.address && <p className="mt-1 text-muted">{g.address}</p>}
        </div>
      </div>
      {s.documents.length > 0 && <DocumentView guestId={g.id} doc={s.documents[0]} />}
    </Card>
  );
}

export function DocumentView({ guestId, doc }: { guestId: string; doc: GuestDocument }) {
  const property = useCurrentProperty();
  const [show, setShow] = useState(false);
  const base = `/properties/${property.id}/guests/${guestId}/documents/${doc.id}`;
  return (
    <div className="mt-4 rounded-lg border border-line px-4 py-3">
      <div className="flex items-center gap-2 text-sm">
        <IdCard className="size-4 text-muted" aria-hidden />
        <span className="flex-1">
          {docTypeLabel[doc.type]}
          {doc.numberLast4 && <span className="font-mono text-muted"> ····{doc.numberLast4}</span>}
        </span>
        {(doc.hasFront || doc.hasBack) && (
          <Button size="sm" variant="ghost" onClick={() => setShow((x) => !x)}>
            {show ? "Hide" : "View ID"}
          </Button>
        )}
      </div>
      {show && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {doc.hasFront && <SecureImage path={`${base}/front`} alt="ID front" className="aspect-[1.586] w-full rounded-md object-cover" auto />}
            {doc.hasBack && <SecureImage path={`${base}/back`} alt="ID back" className="aspect-[1.586] w-full rounded-md object-cover" auto />}
          </div>
          <p className="mt-2 text-xs text-muted">Viewing ID images is recorded.</p>
        </>
      )}
    </div>
  );
}

function ChargeList({ stay }: { stay: StayDetail }) {
  const property = useCurrentProperty();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api(`/properties/${property.id}/stays/${stay.id}/charges/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stay", property.id, stay.id] }),
  });
  return (
    <Disclosure summary="Remove a service" className="mt-3">
      <ul className="flex flex-col gap-1">
        {stay.charges.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-sm">
            <span>
              {c.description} × {c.quantity}
            </span>
            <Button size="sm" variant="ghost" aria-label={`Remove ${c.description}`} loading={del.isPending && del.variables === c.id} onClick={() => del.mutate(c.id)}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function useStayMutation<T>(stay: StayDetail, path: string, method: string, onDone: () => void, setErrors: (e: Record<string, string>) => void) {
  const property = useCurrentProperty();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api<StayDetail>(`/properties/${property.id}/stays/${stay.id}${path}`, { method, body }),
    onSuccess: (d) => {
      qc.setQueryData(["stay", property.id, stay.id], d);
      qc.invalidateQueries({ queryKey: ["rooms", property.id] });
      qc.invalidateQueries({ queryKey: ["stays", property.id] });
      onDone();
    },
    onError: (err) => err instanceof ApiError && err.fields && setErrors(err.fields),
  });
}

const QUICK_SERVICES = ["Breakfast", "Lunch", "Dinner", "Laundry", "Extra bed", "Airport pickup", "Early check-in", "Late checkout"];
/** Early check-in and late checkout are part of the room, so they're billed at the room's GST rate. */
const roomFee = (desc: string) => /^(early check-?in|late check-?out)$/i.test(desc.trim());

function ChargeSheet({ stay, onClose }: { stay: StayDetail; onClose: () => void }) {
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useStayMutation(stay, "/charges", "POST", onClose, setErrors);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Add a service"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ description: desc, quantity: Number(qty) || 0, unitPrice: toPaise(price) ?? 0, kind: roomFee(desc) ? "room" : "service" })}>
            Add to bill
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {QUICK_SERVICES.map((x) => (
            <button key={x} type="button" onClick={() => setDesc(x)} className={clsx("rounded-full border px-3 py-1 text-sm", desc === x ? "border-brand-700 bg-brand-50 text-brand-800" : "border-line-strong hover:bg-sand")}>
              {x}
            </button>
          ))}
        </div>
        <Field label="Service" error={errors.description}>
          {(id, d) => <Input id={id} aria-describedby={d} value={desc} onChange={(e) => setDesc(e.target.value)} invalid={!!errors.description} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" error={errors.quantity}>
            {(id, d) => <Input id={id} aria-describedby={d} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />}
          </Field>
          <Field label="Price each (before GST)" error={errors.unitPrice}>
            {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} invalid={!!errors.unitPrice} />}
          </Field>
        </div>
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
      </div>
    </Sheet>
  );
}

type BillingState = { foodPlan: FoodPlan; billToName: string; billToGstin: string; billToAddress: string; billToState: string };

// The `?.` guards keep this screen working if the API is an older build that doesn't send billing fields yet.
const billingFrom = (s: StayDetail): BillingState => ({
  foodPlan: s.foodPlan ?? "EP",
  billToName: s.billTo?.name ?? "",
  billToGstin: s.billTo?.gstin ?? "",
  billToAddress: s.billTo?.address ?? "",
  billToState: s.billTo?.state ?? "",
});

/** Who the invoice is for and the meal plan. Empty company = the invoice is addressed to the guest. */
function BillingFields({ value, onChange, errors, prefix = "" }: { value: BillingState; onChange: (v: BillingState) => void; errors: Record<string, string>; prefix?: string }) {
  const set = (k: keyof BillingState) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const err = (k: string) => errors[prefix + k];
  return (
    <div className="flex flex-col gap-4">
      <Field label="Meal plan" error={err("foodPlan")}>
        {(id, d) => (
          <Select id={id} aria-describedby={d} value={value.foodPlan} onChange={set("foodPlan")}>
            {(Object.keys(foodPlanLabel) as FoodPlan[]).map((p) => (
              <option key={p} value={p}>
                {foodPlanLabel[p]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Company name" optional error={err("billToName")} hint="Leave empty to bill the guest.">
        {(id, d) => <Input id={id} aria-describedby={d} value={value.billToName} onChange={set("billToName")} invalid={!!err("billToName")} />}
      </Field>
      <Field label="Company GSTIN" optional error={err("billToGstin")}>
        {(id, d) => <Input id={id} aria-describedby={d} className="font-mono uppercase" placeholder="29ABCDE1234F1Z5" value={value.billToGstin} onChange={set("billToGstin")} invalid={!!err("billToGstin")} />}
      </Field>
      <Field label="Company address" optional error={err("billToAddress")}>
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} value={value.billToAddress} onChange={set("billToAddress")} invalid={!!err("billToAddress")} />}
      </Field>
      <Field label="State" optional error={err("billToState")}>
        {(id, d) => <Input id={id} aria-describedby={d} value={value.billToState} onChange={set("billToState")} invalid={!!err("billToState")} />}
      </Field>
    </div>
  );
}

function BillingSheet({ stay, onClose }: { stay: StayDetail; onClose: () => void }) {
  const [v, setV] = useState<BillingState>(() => billingFrom(stay));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useStayMutation(stay, "/billing", "PUT", onClose, setErrors);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Billing details"
      description="Printed on the invoice. You can also set these at checkout."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(v)}>Save</Button>
        </>
      }
    >
      <BillingFields value={v} onChange={setV} errors={errors} />
      {save.error && !(save.error instanceof ApiError && save.error.fields) && <div className="mt-4"><ErrorNote message={save.error.message} /></div>}
    </Sheet>
  );
}

function PaymentFields({
  amount,
  setAmount,
  mode,
  setMode,
  reference,
  setReference,
  errors,
  prefix = "",
  label = "Amount received",
}: {
  amount: string;
  setAmount: (s: string) => void;
  mode: PayMode;
  setMode: (m: PayMode) => void;
  reference: string;
  setReference: (s: string) => void;
  errors: Record<string, string>;
  prefix?: string;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label={label} error={errors[prefix + "amount"]}>
        {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!errors[prefix + "amount"]} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method" error={errors[prefix + "mode"]}>
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
        <Field label="Reference / UTR" optional>
          {(id, d) => <Input id={id} aria-describedby={d} className="font-mono" value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
      </div>
    </div>
  );
}

function PaymentSheet({ stay, onClose }: { stay: StayDetail; onClose: () => void }) {
  const [amount, setAmount] = useState(stay.bill.balance > 0 ? String(stay.bill.balance / 100) : "");
  const [mode, setMode] = useState<PayMode>("upi");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useStayMutation(stay, "/payments", "POST", onClose, setErrors);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Record payment"
      description={stay.bill.balance > 0 ? `${rupees(stay.bill.balance)} is due${stay.bill.estimate ? " (estimate until checkout)" : ""}.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ amount: toPaise(amount) ?? 0, mode, reference })}>
            Record payment
          </Button>
        </>
      }
    >
      <PaymentFields {...{ amount, setAmount, mode, setMode, reference, setReference, errors }} />
      {save.error && !(save.error instanceof ApiError && save.error.fields) && <div className="mt-3"><ErrorNote message={save.error.message} /></div>}
    </Sheet>
  );
}

function EditStaySheet({ stay, onClose }: { stay: StayDetail; onClose: () => void }) {
  const property = useCurrentProperty();
  // Dates are India dates, whatever time zone the device is in.
  const [date, setDate] = useState(hotelDateOf(stay.expectedCheckOutAt));
  const nights = Math.max(1, nightsBetween(stay.arrivalDate, date));
  // Same rules the stay was checked in under: 24-hour stays end n × 24 h after check-in.
  const expected =
    stay.checkoutPolicy === "24h" ? new Date(new Date(stay.checkInAt).getTime() + nights * 86_400_000).toISOString() : hotelInstant(date, property.checkOutTime);
  const [rate, setRate] = useState(String(stay.nightlyRate / 100));
  const [adults, setAdults] = useState(String(stay.adults));
  const [children, setChildren] = useState(String(stay.children));
  const [notes, setNotes] = useState(stay.notes);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useStayMutation(stay, "", "PUT", onClose, setErrors);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Extend or edit stay"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                expectedCheckOutAt: expected,
                nightlyRate: toPaise(rate) ?? -1,
                adults: Number(adults),
                children: Number(children),
                notes,
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Checkout date"
          error={errors.expectedCheckOutAt}
          hint={`${nights} ${nights === 1 ? "night" : "nights"} · due out ${hotelDateTimeLabel(expected)}${stay.checkoutPolicy === "24h" ? " (24-hour checkout)" : ""}`}
        >
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="date"
              min={addDays(stay.arrivalDate, 1)}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              invalid={!!errors.expectedCheckOutAt}
            />
          )}
        </Field>
        <Field label="Rate per night (before GST)" error={errors.nightlyRate}>
          {(id, d) => <Input id={id} aria-describedby={d} prefix="₹" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} invalid={!!errors.nightlyRate} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Adults" error={errors.adults}>{(id) => <Stepper id={id} label="adults" min={1} value={Number(adults) || 1} onChange={(n) => setAdults(String(n))} />}</Field>
          <Field label="Children" error={errors.children}>{(id) => <Stepper id={id} label="children" value={Number(children) || 0} onChange={(n) => setChildren(String(n))} />}</Field>
        </div>
        <Field label="Notes" optional>{(id, d) => <Textarea id={id} aria-describedby={d} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
      </div>
    </Sheet>
  );
}

/** Late checkout under a fixed checkout time: offer the usual half-day fee, at the room's GST rate. */
function LateCheckoutNote({ stay, minutes, onAdded }: { stay: StayDetail; minutes: number; onAdded: () => void }) {
  const property = useCurrentProperty();
  const fee = Math.round(stay.nightlyRate / 2);
  const already = stay.charges.some((c) => roomFee(c.description) && /late/i.test(c.description));
  const add = useStayMutation<{ description: string; quantity: number; unitPrice: number; kind: string }>(stay, "/charges", "POST", onAdded, () => undefined);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (
    <div className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm" role="status">
      <p>
        <strong>Late checkout:</strong> {h > 0 ? `${h} h ` : ""}
        {m} min past {clock12(property.checkOutTime)}.
        {already ? " A late checkout fee is already on the bill." : " Many hotels charge half a night for this."}
      </p>
      {!already && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          loading={add.isPending}
          onClick={() => add.mutate({ description: "Late checkout", quantity: 1, unitPrice: fee, kind: "room" })}
        >
          Add half-day fee ({rupees(fee)})
        </Button>
      )}
      {add.error && <p className="mt-1 text-danger">{add.error.message}</p>}
    </div>
  );
}

function CheckoutSheet({ stay, onClose }: { stay: StayDetail; onClose: () => void }) {
  const property = useCurrentProperty();
  const { user } = useAuth();
  const preview = useQuery({
    queryKey: ["checkout-preview", property.id, stay.id],
    queryFn: () => api<Bill>(`/properties/${property.id}/stays/${stay.id}/checkout`),
    staleTime: 0,
  });
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PayMode>("upi");
  const [reference, setReference] = useState("");
  const [settleLater, setSettleLater] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [billing, setBilling] = useState<BillingState>(() => billingFrom(stay));
  const [wa, setWa] = useState(false);
  const navigate = useNavigate();
  const save = useStayMutation(stay, "/checkout", "POST", () => setDone(true), setErrors);

  const bal = preview.data?.balance ?? 0;
  useEffect(() => {
    if (preview.data) setAmount(String(Math.abs(preview.data.balance) / 100));
  }, [preview.data]);

  const submit = () => {
    const amt = toPaise(amount) ?? 0;
    const pay = { amount: amt, mode, reference };
    save.mutate(bal > 0 ? { payment: settleLater ? null : pay, settleLater, billing } : bal < 0 ? { refund: amt > 0 ? pay : null, billing } : { billing });
  };

  if (done) {
    return (
      <Sheet
        open
        onClose={onClose}
        title="Checked out"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Done</Button>
            <Button icon={<FileText className="size-4" />} onClick={() => navigate(`/stays/${stay.id}/invoice`)}>
              View invoice
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center py-6 text-center">
          <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-ready-bg text-ready">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <p className="font-semibold">{stay.guestName} has checked out.</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <BedDouble className="size-4" aria-hidden /> Room {stay.roomNumber} is now set to Cleaning.
          </p>
          {stay.invoiceNumber && <p className="mt-4 text-sm">Invoice <strong>{stay.invoiceNumber}</strong> is ready.</p>}
          <Button className="mt-3" variant="secondary" size="sm" icon={<MessageCircle className="size-4" />} onClick={() => setWa(true)}>
            Send bill on WhatsApp
          </Button>
          <WhatsAppSend propertyId={property.id} stayId={stay.id} kind="bill" open={wa} onClose={() => setWa(false)} />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Check out room ${stay.roomNumber}`}
      description={`${stay.guestName} · in since ${formatDateTime(stay.checkInAt)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!preview.data} onClick={submit}>
            {bal > 0 && !settleLater ? `Collect ${rupees(toPaise(amount) ?? 0)} & check out` : bal < 0 ? "Refund & check out" : "Check out"}
          </Button>
        </>
      }
    >
      {preview.isLoading ? (
        <Spinner />
      ) : preview.error ? (
        <ErrorNote message={preview.error.message} />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="rounded-lg bg-sand/60 px-3 py-2 text-xs text-ink-soft">
            Final bill for <strong>{preview.data!.nights} {preview.data!.nights === 1 ? "night" : "nights"}</strong>, checking out now
            {stay.checkoutPolicy === "24h" ? " (24-hour checkout)" : ""}.
          </p>
          {(preview.data!.lateCheckoutMinutes ?? 0) > 0 && <LateCheckoutNote stay={stay} minutes={preview.data!.lateCheckoutMinutes!} onAdded={() => void preview.refetch()} />}
          <BillTable bill={preview.data!} />
          <Disclosure summary={billing.billToName ? `Billed to ${billing.billToName}` : "Bill to a company (GST invoice)"}>
            <BillingFields value={billing} onChange={setBilling} errors={errors} prefix="billing." />
          </Disclosure>
          {bal > 0 && (
            <div className="flex flex-col gap-4 border-t border-line pt-4">
              {!settleLater && <PaymentFields {...{ amount, setAmount, mode, setMode, reference, setReference, errors }} prefix="payment." label="Collecting now" />}
              {canManage(user?.role) || user?.role === "front_desk" ? (
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={settleLater} onChange={(e) => setSettleLater(e.target.checked)} />
                  <span>
                    Guest will pay later
                    <span className="block text-muted">Check out now and keep {rupees(bal)} as due. You can record the payment on this stay later.</span>
                  </span>
                </label>
              ) : null}
            </div>
          )}
          {bal < 0 && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <p className="text-sm text-accent-700">The guest paid {rupees(-bal)} more than the final bill. Refund it now:</p>
              <PaymentFields {...{ amount, setAmount, mode, setMode, reference, setReference, errors }} prefix="refund." label="Refunding" />
            </div>
          )}
          {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
        </div>
      )}
    </Sheet>
  );
}
