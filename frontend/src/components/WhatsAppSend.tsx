import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { isNative } from "../lib/platform";
import { Button, ErrorNote, Field, Input, Sheet, Spinner, Textarea } from "./ui";

type Preview = {
  kind: string;
  phone: string;
  body: string;
  openIn: "app" | "web";
  enabled: boolean;
  consent: boolean;
  warnings: string[];
};

export const messageTitle: Record<string, string> = { booking: "Booking confirmation", welcome: "Welcome message", bill: "Bill", review: "Review request" };

/** Builds a click-to-chat link. "web" forces WhatsApp Web; "app" lets the OS open the app (or web if none). */
export function whatsappURL(phone: string, text: string, openIn: "app" | "web"): string {
  const to = phone.replace(/\D/g, "");
  const t = encodeURIComponent(text);
  return openIn === "web" ? `https://web.whatsapp.com/send?phone=${to}&text=${t}` : `https://wa.me/${to}?text=${t}`;
}

/**
 * Preview → (edit) → open WhatsApp with the message typed → ask "Did it send?" → log it.
 * Guestlog can't see inside WhatsApp, so the confirmation step keeps the record honest.
 */
/** WhatsApp Web doesn't work on phones, so the mobile apps always open WhatsApp itself. */
const target = (openIn: "app" | "web") => (isNative ? "app" : openIn);

export function WhatsAppSend({ propertyId, stayId, reservationId, kind, open, onClose }: { propertyId: string; stayId?: string; reservationId?: string; kind: string; open: boolean; onClose: () => void }) {
  const base = reservationId ? `/properties/${propertyId}/reservations/${reservationId}` : `/properties/${propertyId}/stays/${stayId}`;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["message-preview", base, kind],
    queryFn: () => api<Preview>(`${base}/messages/${kind}`),
    enabled: open,
    staleTime: 0,
  });
  const [phone, setPhone] = useState("");
  const [body, setBody] = useState("");
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (q.data) {
      setPhone(q.data.phone);
      setBody(q.data.body);
    }
  }, [q.data]);
  useEffect(() => {
    if (!open) setOpened(false);
  }, [open]);

  const log = useMutation({
    mutationFn: (status: "sent" | "skipped") =>
      api(`${base}/messages`, { method: "POST", body: { kind, phone, body, status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reservationId ? ["reservation", propertyId, reservationId] : ["stay", propertyId, stayId] });
      onClose();
    },
  });

  const title = messageTitle[kind] ?? "WhatsApp message";
  const p = q.data;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={opened ? "Did the message send?" : `Send ${title.toLowerCase()}`}
      description={opened ? undefined : "Check the message, then WhatsApp opens with it typed. You just press Send."}
      footer={
        opened ? (
          <>
            <Button variant="secondary" loading={log.isPending && log.variables === "skipped"} onClick={() => log.mutate("skipped")}>
              No, not sent
            </Button>
            <Button loading={log.isPending && log.variables === "sent"} onClick={() => log.mutate("sent")}>
              Yes, it's sent
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Not now</Button>
            <Button
              disabled={!p || !phone || !body.trim()}
              icon={<MessageCircle className="size-4" />}
              onClick={() => {
                window.open(whatsappURL(phone, body, target(p!.openIn)), "_blank", "noopener");
                setOpened(true);
              }}
            >
              Open WhatsApp
            </Button>
          </>
        )
      }
    >
      {!open ? null : q.isLoading || !p ? (
        q.error ? <ErrorNote message={q.error.message} onRetry={() => q.refetch()} /> : <Spinner />
      ) : q.error ? (
        <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />
      ) : opened ? (
        <div className="text-sm text-ink-soft">
          <p>
            WhatsApp opened in a new {p?.openIn === "web" ? "tab" : "window"}. Once you've pressed <strong>Send</strong> there, confirm here so it's
            recorded on the guest's stay.
          </p>
          <p className="mt-3 text-muted">
            Nothing opened?{" "}
            <a href={whatsappURL(phone, body, target(p!.openIn))} target="_blank" rel="noopener" className="font-semibold text-brand-700 hover:underline">
              Open WhatsApp again
            </a>
          </p>
          {log.error && <div className="mt-3"><ErrorNote message={log.error.message} /></div>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {p!.warnings.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2.5 text-sm text-accent-700">
              {p!.warnings.map((w) => (
                <li key={w} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
          )}
          <Field label="Guest's WhatsApp number">
            {(id, d) => <Input id={id} aria-describedby={d} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          </Field>
          <Field label="Message" hint="You can edit it for this guest. To change it for everyone, go to Settings → Messages.">
            {(id, d) => <Textarea id={id} aria-describedby={d} rows={11} value={body} onChange={(e) => setBody(e.target.value)} />}
          </Field>
        </div>
      )}
    </Sheet>
  );
}
