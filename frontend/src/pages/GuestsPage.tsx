import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ChevronRight, Phone, Search, Users } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, EmptyState, ErrorNote, Input, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { rupees } from "../lib/format";
import { useCurrentProperty } from "../lib/property";
import { COUNTRIES, formatDay, formatPhone, useStays, type Guest, type GuestDocument, type StaySummary } from "../lib/stays";
import { DocumentView, SecureImage } from "./StayPage";

const countryName = (c: string) => COUNTRIES.find(([k]) => k === c)?.[1] ?? c;

export function StayRow({ s }: { s: StaySummary }) {
  const today = new Date().toDateString();
  const dueToday = s.status === "in_house" && new Date(s.expectedCheckOutAt).toDateString() === today;
  const overdue = s.status === "in_house" && new Date(s.expectedCheckOutAt) < new Date() && !dueToday;
  return (
    <Link to={`/stays/${s.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sand/60">
      <span className="tabular flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-sand font-display text-lg font-bold text-ink">
        {s.roomNumber}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{s.guestName}</span>
        <span className="block truncate text-xs text-muted">
          {s.adults + s.children} {s.adults + s.children === 1 ? "guest" : "guests"} ·{" "}
          {s.status === "in_house" ? `out ${formatDay(s.expectedCheckOutAt)}` : `stayed ${formatDay(s.checkInAt)} – ${formatDay(s.checkedOutAt!)}`}
        </span>
      </span>
      {dueToday && <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-700">Leaving today</span>}
      {overdue && <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger">Past checkout</span>}
      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}

export function GuestsPage() {
  const property = useCurrentProperty();
  const [tab, setTab] = useState<"in_house" | "checked_out" | "search">("in_house");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const inHouse = useStays(property.id, "in_house");
  const past = useStays(property.id, "checked_out");
  const search = useQuery({
    queryKey: ["guest-search", property.id, query],
    queryFn: () => api<Guest[]>(`/properties/${property.id}/guests?q=${encodeURIComponent(query)}`),
    enabled: tab === "search",
  });

  const tabs = [
    { key: "in_house", label: "In-house", count: inHouse.data?.length },
    { key: "checked_out", label: "Checked out" },
    { key: "search", label: "All guests" },
  ] as const;

  return (
    <>
      <PageHeader title="Guests" description="Who's staying now, past stays, and every guest's history." />
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold",
              tab === t.key ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            {"count" in t && t.count !== undefined && <span className="ml-1.5 text-muted">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <div className="relative mb-4 sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone number" className="pl-9" aria-label="Search guests" autoFocus />
        </div>
      )}

      {tab !== "search" ? (
        <StayList q={tab === "in_house" ? inHouse : past} empty={tab === "in_house" ? "No one is checked in right now." : "No checkouts yet."} />
      ) : search.isLoading ? (
        <Spinner />
      ) : search.error ? (
        <ErrorNote message={search.error.message} />
      ) : search.data!.length === 0 ? (
        <Card>
          <EmptyState icon={<Users className="size-6" />} title={query ? "No guests match" : "No guests yet"} body={query ? "Try part of the name, or the last digits of their phone." : "Guests appear here after their first check-in."} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {search.data!.map((g) => (
              <li key={g.id}>
                <Link to={`/guests/${g.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sand/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{g.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {g.phone ? formatPhone(g.phone) : "No phone"} · {countryName(g.nationality)} · {g.stayCount} {g.stayCount === 1 ? "stay" : "stays"}
                      {g.lastStayAt && ` · last ${formatDay(g.lastStayAt)}`}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function StayList({ q, empty }: { q: ReturnType<typeof useStays>; empty: string }) {
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />;
  if (!q.data!.length) return <Card><p className="px-5 py-10 text-center text-sm text-muted">{empty}</p></Card>;
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {q.data!.map((s) => (
          <li key={s.id}>
            <StayRow s={s} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function GuestDetailPage() {
  const { guestId = "" } = useParams();
  const property = useCurrentProperty();
  const q = useQuery({
    queryKey: ["guest", property.id, guestId],
    queryFn: () => api<{ guest: Guest; documents: GuestDocument[]; stays: StaySummary[] }>(`/properties/${property.id}/guests/${guestId}`),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote message={q.error.message} onRetry={() => q.refetch()} />;
  const { guest: g, documents, stays } = q.data!;
  const spent = stays.reduce((s, x) => s + x.paid, 0);

  return (
    <>
      <Link to="/guests" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Guests
      </Link>
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card className="px-5 py-5">
          <div className="mx-auto mb-4 size-28 overflow-hidden rounded-2xl border border-line">
            {g.hasPhoto ? (
              <SecureImage path={`/properties/${property.id}/guests/${g.id}/photo`} alt={`${g.name}'s photo`} className="size-full object-cover" auto />
            ) : (
              <div className="flex size-full items-center justify-center bg-sand text-xs text-muted">No photo</div>
            )}
          </div>
          <h1 className="text-center font-display text-2xl font-bold">{g.name}</h1>
          <dl className="mt-4 space-y-2 text-sm">
            {g.phone && (
              <div className="flex items-center gap-2">
                <Phone className="size-4 text-muted" aria-hidden />
                <a href={`tel:${g.phone}`} className="hover:underline">{formatPhone(g.phone)}</a>
              </div>
            )}
            <div className="flex justify-between"><dt className="text-muted">Nationality</dt><dd>{countryName(g.nationality)}</dd></div>
            {g.email && <div className="flex justify-between gap-3"><dt className="text-muted">Email</dt><dd className="truncate">{g.email}</dd></div>}
            {g.birthYear && <div className="flex justify-between"><dt className="text-muted">Born</dt><dd>{g.birthYear}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">WhatsApp</dt><dd>{g.whatsappConsent ? "Agreed" : "Not agreed"}</dd></div>
            {g.address && <div><dt className="text-muted">Address</dt><dd className="mt-0.5">{g.address}</dd></div>}
          </dl>
          {documents.map((d) => (
            <DocumentView key={d.id} guestId={g.id} doc={d} />
          ))}
        </Card>
        <div>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Card className="px-4 py-3">
              <p className="text-xs text-muted">Stays</p>
              <p className="tabular font-display text-2xl font-bold">{g.stayCount}</p>
            </Card>
            <Card className="px-4 py-3">
              <p className="text-xs text-muted">Paid in total</p>
              <p className="tabular font-display text-2xl font-bold">{rupees(spent)}</p>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <h2 className="border-b border-line px-5 py-3 font-semibold">Stay history</h2>
            {stays.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">No stays yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {stays.map((s) => (
                  <li key={s.id}>
                    <StayRow s={s} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
