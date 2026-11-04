import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export type RoomStatus = "ready" | "occupied" | "cleaning" | "maintenance";

export type Room = {
  id: string;
  number: string;
  floor: number;
  status: RoomStatus;
  notes: string;
  roomTypeId: string;
  typeName: string;
  bedType: string;
  baseRate: number;
  stayId: string | null;
  guestName: string | null;
  expectedCheckOutAt: string | null;
};

export type RoomSummary = Record<RoomStatus | "total" | "floors", number>;

export type RoomType = {
  id: string;
  name: string;
  bedType: string;
  baseRate: number;
  maxGuests: number;
  roomCount: number;
};

export const statusMeta: Record<RoomStatus, { label: string; text: string; bg: string; bar: string }> = {
  ready: { label: "Ready", text: "text-ready", bg: "bg-ready-bg", bar: "bg-ready" },
  occupied: { label: "Occupied", text: "text-occupied", bg: "bg-occupied-bg", bar: "bg-occupied" },
  cleaning: { label: "Cleaning", text: "text-cleaning", bg: "bg-cleaning-bg", bar: "bg-marigold-400" },
  maintenance: { label: "Maintenance", text: "text-maintenance", bg: "bg-maintenance-bg", bar: "bg-maintenance" },
};

/** Mirrors the backend's manual housekeeping transitions. Occupied changes only through check-in/out. */
export const manualNext: Record<RoomStatus, RoomStatus[]> = {
  ready: ["cleaning", "maintenance"],
  cleaning: ["ready", "maintenance"],
  maintenance: ["ready", "cleaning"],
  occupied: [],
};

export function useRooms(propertyId: string) {
  return useQuery({
    queryKey: ["rooms", propertyId],
    queryFn: () => api<{ rooms: Room[]; summary: RoomSummary }>(`/properties/${propertyId}/rooms`),
  });
}

export function useRoomTypes(propertyId: string) {
  return useQuery({
    queryKey: ["room-types", propertyId],
    queryFn: () => api<RoomType[]>(`/properties/${propertyId}/room-types`),
  });
}

export function useSetRoomStatus(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, status }: { roomId: string; status: RoomStatus }) =>
      api(`/properties/${propertyId}/rooms/${roomId}/status`, { method: "PATCH", body: { status } }),
    // Optimistic: housekeeping taps should feel instant.
    onMutate: async ({ roomId, status }) => {
      const key = ["rooms", propertyId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ rooms: Room[]; summary: RoomSummary }>(key);
      if (prev) {
        const old = prev.rooms.find((r) => r.id === roomId)?.status;
        qc.setQueryData(key, {
          rooms: prev.rooms.map((r) => (r.id === roomId ? { ...r, status } : r)),
          summary: old ? { ...prev.summary, [old]: prev.summary[old] - 1, [status]: prev.summary[status] + 1 } : prev.summary,
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["rooms", propertyId], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rooms", propertyId] }),
  });
}
