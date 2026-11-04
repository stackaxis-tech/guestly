import clsx from "clsx";
import { ArrowRight, BarChart3, LogIn, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";
import { useAuth } from "../lib/auth";
import { todayLabel } from "../lib/format";
import { useCurrentProperty } from "../lib/property";
import { statusMeta, useRooms, type RoomStatus } from "../lib/rooms";
import { useStays } from "../lib/stays";
import { StayRow } from "./GuestsPage";

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
  const s = rooms.data?.summary;
  const firstName = user?.name.split(" ")[0] ?? "";

  const today = new Date().toDateString();
  const leaving = (stays.data ?? []).filter((x) => new Date(x.expectedCheckOutAt).toDateString() === today || new Date(x.expectedCheckOutAt) < new Date());
  const staying = (stays.data ?? []).filter((x) => !leaving.includes(x));

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`${todayLabel()} · ${property.name}`}
        actions={
          !isHousekeeping && (
            <Link to="/check-in">
              <Button icon={<LogIn className="size-4" />}>New check-in</Button>
            </Link>
          )
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
              <p className="tabular mt-2 font-display text-3xl font-semibold">{s ? s[k] : "–"}</p>
            </Card>
          </Link>
        ))}
      </div>

      {s && s.cleaning > 0 && (
        <Link
          to="/rooms"
          className="mt-4 flex items-center gap-3 rounded-xl border border-marigold-200 bg-marigold-50 px-4 py-3 text-sm text-marigold-700 hover:bg-marigold-100"
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
              <h2 className="font-semibold">In-house</h2>
              <span className="text-sm text-muted">{staying.length}</span>
            </div>
            {staying.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-muted">No other guests in-house.</p>
                <Link to="/check-in" className="mt-2 inline-block text-sm font-semibold text-teal-700 hover:underline">
                  Check a guest in
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {staying.map((x) => (
                  <li key={x.id}>
                    <StayRow s={x} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

export function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Occupancy, revenue, and guest ratings." />
      <Card>
        <EmptyState
          icon={<BarChart3 className="size-6" />}
          title="Reports are coming soon"
          body="Occupancy, average rate, revenue by payment method, and review scores will show here, built from your stays and invoices."
        />
      </Card>
    </>
  );
}
