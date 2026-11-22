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
import { manualNext, statusMeta, useRooms, useSetRoomStatus, type Room, type RoomStatus } from "../lib/rooms";

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
        description="Live status of every room."
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
            action={manager && <Link to="/settings/room-types"><Button variant="secondary">Set up room types</Button></Link>}
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
                  <h2 id={`floor-${floor}`} className="font-display text-[15px] font-bold text-ink">
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
          <p className="tabular mt-0.5 font-display text-3xl font-bold">
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
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter by status">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => onFilter(c.key)}
            aria-pressed={filter === c.key}
            className={clsx(
              "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              filter === c.key ? "border-ink bg-ink text-white" : "border-line bg-paper text-ink-soft hover:border-line-strong hover:bg-sand",
            )}
          >
            {c.dot && <span className={clsx("size-2 rounded-full", c.dot)} aria-hidden />}
            {c.label}
            <span className={clsx("tabular", filter === c.key ? "text-white/70" : "text-muted")}>{c.count}</span>
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
      className="pressable surface group relative min-w-0 overflow-hidden p-3.5 pl-4.5 text-left transition-colors hover:bg-sand/40"
    >
      <span className={clsx("absolute inset-y-0 left-0 w-1", m.bar)} aria-hidden />
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="tabular font-display text-2xl leading-tight font-bold">{room.number}</span>
        <span className={clsx("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", m.bg, m.text)}>
          <span className={clsx("size-1.5 rounded-full", m.bar)} aria-hidden />
          {m.label}
        </span>
      </div>
      {room.reservedFor && !room.guestName ? (
        <>
          <p className="mt-2 truncate text-[13px] font-semibold text-accent-700">Held: {room.reservedFor}</p>
          <p className="truncate text-xs text-muted">{room.typeName}</p>
        </>
      ) : room.guestName ? (
        <>
          <p className="mt-2 truncate text-[13px] font-semibold text-ink">{room.guestName}</p>
          <p className="truncate text-xs text-muted">
            out {new Date(room.expectedCheckOutAt!).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 truncate text-[13px] font-medium text-ink-soft">{room.typeName}</p>
          <p className="flex min-w-0 text-xs text-muted">
            <span className="truncate">{room.bedType}</span>
            <span className="shrink-0 whitespace-pre"> · </span>
            <span className="tabular shrink-0">{rupees(room.baseRate)}</span>
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
          {room.reservedFor && user?.role !== "housekeeping" && (
            <p className="mb-3 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-700">
              Held for <strong>{room.reservedFor}</strong> today.
            </p>
          )}
          {room.status === "ready" && user?.role !== "housekeeping" && (
            <Link to={room.reservationId ? `/check-in?reservation=${room.reservationId}` : `/check-in?room=${room.id}`}>
              <Button className="mb-5 w-full" icon={<LogIn className="size-4" />}>{room.reservationId ? `Check in ${room.reservedFor}` : "Check a guest in here"}</Button>
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

const ROOM_TYPES = ["Standard", "Deluxe", "Suite"] as const;
const BED_CONFIGS = ["Single", "Double", "Queen", "King", "Twin", "King + Sofa Bed"] as const;

const roomSchema = z.object({
  number: z.string().trim().min(1, "Enter a room number.").max(10, "Up to 10 characters."),
  floor: z.coerce.number().int("Whole numbers only.").min(-2, "Enter a valid floor.").max(200, "Enter a valid floor."),
  roomType: z.string().min(1, "Select a room type."),
  bedConfiguration: z.string().min(1, "Select a bed configuration."),
  notes: z.string().max(500).optional().default(""),
});
type RoomValues = z.input<typeof roomSchema>;

function RoomForm({ propertyId, room, onClose }: { propertyId: string; room: Room | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = room === "new";
  const existing = room && room !== "new" ? room : null;

  const form = useForm<RoomValues>({
    resolver: zodResolver(roomSchema),
    mode: "onTouched",
    values: existing
      ? {
          number: existing.number,
          floor: existing.floor,
          roomType: existing.typeName || "Standard",
          bedConfiguration: existing.bedType || "Double",
          notes: existing.notes || "",
        }
      : {
          number: "",
          floor: 1,
          roomType: "Standard",
          bedConfiguration: "Double",
          notes: "",
        },
  });

  const save = useMutation({
    mutationFn: (v: z.output<typeof roomSchema>) =>
      existing
        ? api(`/properties/${propertyId}/rooms/${existing.id}`, { method: "PUT", body: v })
        : api(`/properties/${propertyId}/rooms`, { method: "POST", body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms", propertyId] });
      qc.invalidateQueries({ queryKey: ["room-types", propertyId] });
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
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
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      onClose();
    },
  });

  const e = form.formState.errors;
  const formId = "room-form";

  return (
    <Sheet
      open={room !== null}
      onClose={onClose}
      title={isNew ? "Add a room" : `Edit room ${existing?.number ?? ""}`}
      description="Setup room details. Rates vary by season and are entered during billing."
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
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={form.handleSubmit((v) => save.mutate(v as z.output<typeof roomSchema>))} className="flex flex-col gap-4" noValidate>
        {save.error && !(save.error instanceof ApiError && save.error.fields) && <ErrorNote message={save.error.message} />}
        {remove.error && <ErrorNote message={remove.error.message} />}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Room number" error={e.number?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} placeholder="e.g. 101" invalid={!!e.number} {...form.register("number")} />}
          </Field>
          <Field label="Floor" error={e.floor?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" invalid={!!e.floor} {...form.register("floor")} />}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Room type" error={e.roomType?.message}>
            {(id, d) => (
              <Select id={id} aria-describedby={d} invalid={!!e.roomType} {...form.register("roomType")}>
                {ROOM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Bed configuration" error={e.bedConfiguration?.message}>
            {(id, d) => (
              <Select id={id} aria-describedby={d} invalid={!!e.bedConfiguration} {...form.register("bedConfiguration")}>
                {BED_CONFIGS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="rounded-lg bg-ready-bg/60 p-3 text-xs text-ready border border-ready/20">
          <p className="font-semibold">Default status: Ready to occupy</p>
          <p className="mt-0.5 text-ink-soft">Newly created rooms start as ready to occupy immediately.</p>
        </div>

        <Field label="Notes" optional error={e.notes?.message}>
          {(id, d) => <Textarea id={id} aria-describedby={d} placeholder="Balcony view, corner room, ground floor access…" {...form.register("notes")} />}
        </Field>
      </form>
    </Sheet>
  );
}
