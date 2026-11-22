/**
 * Everything Home needs about today, from the queries the app already makes:
 * rooms, in-house guests, today's arrivals and departures, and money to collect.
 */
import { useMemo } from "react";
import type { User } from "./api";
import { useCurrentProperty } from "./property";
import { addDays, hotelToday, useReservations, type Reservation } from "./reservations";
import { useRooms, type Room } from "./rooms";
import { useStays, type StaySummary } from "./stays";

export const istDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));

export type Today = {
  loading: boolean;
  todayIso: string;
  rooms: Room[];
  inHouse: StaySummary[];
  arrivals: Reservation[];
  /** In-house guests due out today or earlier. */
  leaving: StaySummary[];
  overdue: StaySummary[];
  checkedOutToday: StaySummary[];
  toCollect: number;
  occupancy: number; // 0–100
};

export function useToday(role: User["role"] | undefined): Today {
  const property = useCurrentProperty();
  const desk = role !== undefined && role !== "housekeeping";
  const todayIso = hotelToday();
  const rooms = useRooms(property.id);
  const inHouse = useStays(property.id, "in_house", desk);
  const session = useStays(property.id, "today_session", desk);
  const bookings = useReservations(property.id, addDays(todayIso, -14), addDays(todayIso, 1), desk);

  return useMemo(() => {
    const house = inHouse.data ?? [];
    const list = rooms.data?.rooms ?? [];
    const leaving = house.filter((s) => istDate(s.expectedCheckOutAt) <= todayIso);
    const sellable = list.filter((r) => r.status !== "maintenance").length;
    return {
      loading: rooms.isLoading || (desk && (inHouse.isLoading || bookings.isLoading)),
      todayIso,
      rooms: list,
      inHouse: house,
      arrivals: (bookings.data ?? []).filter((r) => r.status === "booked" && r.checkIn <= todayIso && r.checkOut > todayIso),
      leaving,
      overdue: leaving.filter((s) => istDate(s.expectedCheckOutAt) < todayIso),
      checkedOutToday: (session.data ?? []).filter((s) => s.status === "checked_out"),
      toCollect: house.reduce((sum, s) => sum + Math.max(0, s.balance), 0),
      occupancy: sellable ? Math.round((list.filter((r) => r.status === "occupied").length / sellable) * 100) : 0,
    };
  }, [rooms.data, rooms.isLoading, inHouse.data, inHouse.isLoading, session.data, bookings.data, bookings.isLoading, desk, todayIso]);
}
