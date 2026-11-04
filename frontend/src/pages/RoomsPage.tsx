import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BedDouble, CheckCircle2, LogIn, Plus, Sparkles, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Sheet, Spinner, Textarea } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { canManage, useAuth } from "../lib/auth";
import { rupees } from "../lib/format";
import { useCurrentProperty } from "../lib/property";
import { manualNext, statusMeta, useRooms, useRoomTypes, useSetRoomStatus, type Room, type RoomStatus } from "../lib/rooms";

type Filter = RoomStatus | "all";

export function RoomsPage() {
  const property = useCurrentProperty();
  const { user } = useAuth();
  const rooms = useRooms(property.id);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Room | null>(null);
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const manager = canManage(user?.role);

  const byFloor = useMemo(() => {
    const list = (rooms.data?.rooms ?? []).filter((r) => filter === "all" || r.status === filter);
    const map = new Map<number, Room[]>();
    for (const r of list) map.set(r.floor, [...(map.get(r.floor) ?? []), r]);
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [rooms.data, filter]);

  // Keep the open sheet in sync with optimistic updates.
  const live = selected ? rooms.data?.rooms.find((r) => r.id === selected.id) ?? null : null;

  return (
    <>
      <PageHeader
        title="Rooms"
        description="Live availability and housekeeping across the property."
        actions={manager && <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Add room</Button>}
      />

      {rooms.isLoading ? (
        <Spinner label="Loading rooms" />
      ) : rooms.error ? (
        <ErrorNote message={rooms.error.message} onRetry={() => rooms.refetch()} />
      ) : rooms.data!.rooms.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BedDouble className="size-6" />}
            title="No rooms yet"
            body={manager ? "Add room types (like Deluxe or Suite) in Settings, then add your rooms here." : "Ask a manager to add the property's rooms."}
            action={manager && <Link to="/settings"><Button variant="secondary">Set up room types</Button></Link>}
          />
        </Card>
      ) : (
        <>
          <Summary summary={rooms.data!.summary} filter={filter} onFilter={setFilter} />
          <div className="mt-6 flex flex-col gap-8">
            {byFloor.length === 0 && (
              <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
                No rooms are {statusMeta[filter as RoomStatus].label.toLowerCase()} right now.
              </p>
            )}
            {byFloor.map(([floor, list]) => (
              <section key={floor} aria-labelledby={`floor-${floor}`}>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 id={`floor-${floor}`} className="text-sm font-semibold tracking-wide text-ink-soft uppercase">
                    {floor === 0 ? "Ground floor" : `Floor ${floor}`}
                  </h2>
                  <span className="text-xs text-muted">{list.length} rooms</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {list.map((r) => (
                    <RoomTile key={r.id} room={r} onClick={() => setSelected(r)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      <RoomSheet
        room={live}
        propertyId={property.id}
        manager={manager}
        onClose={() => setSelected(null)}
        onEdit={(r) => {
          setSelected(null);
          setEditing(r);
        }}
      />
      <RoomForm propertyId={property.id} room={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function Summary({ summary, filter, onFilter }: { summary: Record<string, number>; filter: Filter; onFilter: (f: Filter) => void }) {
  const occupancy = summary.total ? Math.round((summary.occupied / summary.total) * 100) : 0;
  const chips: { key: Filter; label: string; count: number; dot?: string }[] = [
    { key: "all", label: "All", count: summary.total },
    { key: "ready", label: "Ready", count: summary.ready, dot: statusMeta.ready.bar },
    { key: "occupied", label: "Occupied", count: summary.occupied, dot: statusMeta.occupied.bar },
    { key: "cleaning", label: "Cleaning", count: summary.cleaning, dot: statusMeta.cleaning.bar },
    { key: "maintenance", label: "Maintenance", count: summary.maintenance, dot: statusMeta.maintenance.bar },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <div>
          <p className="text-xs font-medium text-muted">Occupancy now</p>
          <p className="tabular mt-0.5 font-display text-3xl font-semibold">
            {occupancy}
            <span className="text-lg text-muted">%</span>
          </p>
        </div>
        <div className="h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-sand" aria-hidden>
          <div className="flex h-full">
            {(["occupied", "cleaning", "maintenance", "ready"] as RoomStatus[]).map((s) => (
              <div key={s} className={statusMeta[s].bar} style={{ width: `${(summary[s] / Math.max(summary.total, 1)) * 100}%` }} />
            ))}
          </div>
        </div>
        <p className="tabular text-sm text-muted">
          {summary.occupied} of {summary.total} rooms · {summary.floors} floors
        </p>
      </Card>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="group" aria-label="Filter by status">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => onFilter(c.key)}
            aria-pressed={filter === c.key}
            className={clsx(
              "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              filter === c.key ? "border-teal-700 bg-teal-700 text-ivory" : "border-line-strong bg-paper text-ink-soft hover:bg-sand",
            )}
          >
            {c.dot && <span className={clsx("size-2 rounded-full", c.dot)} aria-hidden />}
            {c.label}
            <span className={clsx("tabular", filter === c.key ? "text-teal-100" : "text-muted")}>{c.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoomTile({ room, onClick }: { room: Room; onClick: () => void }) {
  const m = statusMeta[room.status];
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-xl border border-line bg-paper p-3.5 text-left shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md"
    >
      <span className={clsx("absolute inset-y-0 left-0 w-1", m.bar)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <span className="tabular font-display text-2xl font-semibold">{room.number}</span>
        <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", m.bg, m.text)}>{m.label}</span>
      </div>
      {room.guestName ? (
        <>
          <p className="mt-2 truncate text-[13px] font-semibold text-ink">{room.guestName}</p>
          <p className="truncate text-xs text-muted">
            out {new Date(room.expectedCheckOutAt!).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 truncate text-[13px] font-medium text-ink-soft">{room.typeName}</p>
          <p className="truncate text-xs text-muted">
            {room.bedType} · <span className="tabular">{rupees(room.baseRate)}</span>
          </p>
        </>
      )}
    </button>
  );
}

const actionCopy: Record<RoomStatus, { label: string; icon: typeof Sparkles }> = {
  ready: { label: "Mark ready", icon: CheckCircle2 },
  cleaning: { label: "Needs cleaning", icon: Sparkles },
  maintenance: { label: "Under maintenance", icon: Wrench },
  occupied: { label: "Occupied", icon: BedDouble },
};

function RoomSheet({
  room,
  propertyId,
  manager,
  onClose,
  onEdit,
}: {
  room: Room | null;
  propertyId: string;
  manager: boolean;
  onClose: () => void;
  onEdit: (r: Room) => void;
}) {
  const setStatus = useSetRoomStatus(propertyId);
  const { user } = useAuth();
  if (!room) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const m = statusMeta[room.status];
  const next = manualNext[room.status].filter((s) => !(s === "maintenance" && user?.role === "housekeeping"));

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Room ${room.number}`}
      description={`${room.typeName} · ${room.bedType} · Floor ${room.floor}`}
      footer={manager && <Button variant="secondary" onClick={() => onEdit(room)}>Edit room</Button>}
    >
      <div className={clsx("flex items-center gap-3 rounded-lg px-4 py-3", m.bg)}>
        <span className={clsx("size-2.5 rounded-full", m.bar)} aria-hidden />
        <span className={clsx("text-sm font-semibold", m.text)}>{m.label}</span>
        <span className="ml-auto tabular text-sm text-ink-soft">{rupees(room.baseRate)} / night</span>
      </div>

      {room.status === "occupied" ? (
        <div className="mt-5">
          <p className="text-sm text-ink-soft">
            <strong>{room.guestName ?? "A guest"}</strong> is staying here
            {room.expectedCheckOutAt && ` until ${new Date(room.expectedCheckOutAt).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`}.
          </p>
          {room.stayId && user?.role !== "housekeeping" && (
            <Link to={`/stays/${room.stayId}`}>
              <Button className="mt-3 w-full">Open stay & check out</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-5">
          {room.status === "ready" && user?.role !== "housekeeping" && (
            <Link to={`/check-in?room=${room.id}`}>
              <Button className="mb-5 w-full" icon={<LogIn className="size-4" />}>Check a guest in here</Button>
            </Link>
          )}
          <p className="mb-2 text-sm font-medium text-ink-soft">Update housekeeping</p>
          <div className="flex flex-col gap-2">
            {next.map((s) => {
              const { label, icon: Icon } = actionCopy[s];
              return (
                <Button
                  key={s}
                  variant={s === "ready" ? "primary" : "secondary"}
                  className="justify-start"
                  icon={<Icon className="size-4" />}
                  loading={setStatus.isPending && setStatus.variables?.status === s}
                  onClick={() => setStatus.mutate({ roomId: room.id, status: s })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          {setStatus.error && <div className="mt-3"><ErrorNote message={setStatus.error.message} /></div>}
        </div>
      )}

      {room.notes && (
        <div className="mt-6">
          <p className="mb-1 text-sm font-medium text-ink-soft">Notes</p>
          <p className="text-sm whitespace-pre-wrap text-muted">{room.notes}</p>
        </div>
      )}
    </Sheet>
  );
}

const roomSchema = z.object({
  number: z.string().trim().min(1, "Enter a room number.").max(10, "Up to 10 characters."),
  floor: z.coerce.number().int("Whole numbers only.").min(-2).max(200),
  roomTypeId: z.string().min(1, "Choose a room type."),
  notes: z.string().max(500),
});
type RoomValues = z.input<typeof roomSchema>;

function RoomForm({ propertyId, room, onClose }: { propertyId: string; room: Room | "new" | null; onClose: () => void }) {
  const types = useRoomTypes(propertyId);
  const qc = useQueryClient();
  const isNew = room === "new";
  const existing = room && room !== "new" ? room : null;

  const form = useForm<RoomValues>({
    resolver: zodResolver(roomSchema),
    mode: "onTouched",
    values: existing
      ? { number: existing.number, floor: existing.floor, roomTypeId: existing.roomTypeId, notes: existing.notes }
      : { number: "", floor: 1, roomTypeId: types.data?.[0]?.id ?? "", notes: "" },
  });

  const save = useMutation({
    mutationFn: (v: z.output<typeof roomSchema>) =>
      existing
        ? api(`/properties/${propertyId}/rooms/${existing.id}`, { method: "PUT", body: v })
        : api(`/properties/${propertyId}/rooms`, { method: "POST", body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms", propertyId] });
      qc.invalidateQueries({ queryKey: ["room-types", propertyId] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields)
        for (const [k, v] of Object.entries(err.fields)) form.setError(k as keyof RoomValues, { message: v });
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/properties/${propertyId}/rooms/${existing!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms", propertyId] });
      onClose();
    },
  });

  const e = form.formState.errors;
  const noTypes = types.data && types.data.length === 0;
  const formId = "room-form";

  return (
    <Sheet
      open={room !== null}
      onClose={onClose}
      title={isNew ? "Add a room" : `Edit room ${existing?.number ?? ""}`}
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              className="mr-auto text-danger hover:bg-danger-bg hover:text-danger"
              loading={remove.isPending}
              onClick={() => {
                if (confirm(`Remove room ${existing.number}? This can't be undone.`)) remove.mutate();
              }}
            >
              Remove room {existing.number}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} loading={save.isPending} disabled={noTypes}>
            {isNew ? "Add room" : "Save changes"}
          </Button>
        </>
      }
    >
      {noTypes ? (
        <p className="text-sm text-muted">
          Create a room type first in{" "}
          <Link to="/settings" className="font-semibold text-teal-700 hover:underline" onClick={onClose}>Settings</Link>.
        </p>
      ) : (
        <form id={formId} onSubmit={form.handleSubmit((v) => save.mutate(v as z.output<typeof roomSchema>))} className="flex flex-col gap-4" noValidate>
          {(save.error && !(save.error instanceof ApiError && save.error.fields)) && <ErrorNote message={save.error.message} />}
          {remove.error && <ErrorNote message={remove.error.message} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Room number" error={e.number?.message}>
              {(id, d) => <Input id={id} aria-describedby={d} placeholder="101" invalid={!!e.number} {...form.register("number")} />}
            </Field>
            <Field label="Floor" error={e.floor?.message}>
              {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" invalid={!!e.floor} {...form.register("floor")} />}
            </Field>
          </div>
          <Field label="Room type" error={e.roomTypeId?.message}>
            {(id, d) => (
              <Select id={id} aria-describedby={d} invalid={!!e.roomTypeId} {...form.register("roomTypeId")}>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.bedType} · {rupees(t.baseRate)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Notes" optional error={e.notes?.message}>
            {(id, d) => <Textarea id={id} aria-describedby={d} placeholder="Sea-facing balcony, ground-floor access…" {...form.register("notes")} />}
          </Field>
        </form>
      )}
    </Sheet>
  );
}
