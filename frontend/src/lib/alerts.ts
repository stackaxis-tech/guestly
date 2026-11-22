/**
 * Things that need attention, worked out on the device from queries the app
 * already makes (rooms, stays, bookings, plan). Shown behind the bell.
 */
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, BedDouble, CalendarClock, IndianRupee, LogOut } from "lucide-react";
import { canManage } from "./auth";
import type { User } from "./api";
import { rupees } from "./format";
import type { Property } from "./property";
import { addDays, hotelToday, useReservations } from "./reservations";
import { useRooms } from "./rooms";
import { useStays } from "./stays";

export type Alert = { id: string; icon: LucideIcon; title: string; body: string; to: string; tone: "info" | "warn" | "danger" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const istDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));

export function useAlerts(property: Property, role: User["role"] | undefined): Alert[] {
  const desk = role !== undefined && role !== "housekeeping";
  const today = hotelToday();
  const rooms = useRooms(property.id);
  const stays = useStays(property.id, "in_house", desk);
  const bookings = useReservations(property.id, addDays(today, -14), addDays(today, 1), desk);

  const out: Alert[] = [];
  const cleaning = rooms.data?.summary.cleaning ?? 0;
  if (cleaning > 0) {
    out.push({ id: "cleaning", icon: BedDouble, title: plural(cleaning, "room needs", "rooms need") + " cleaning", body: "They can't be assigned until they're ready.", to: "/rooms", tone: "warn" });
  }
  if (desk) {
    const late = (bookings.data ?? []).filter((r) => r.status === "booked" && r.checkIn < today && r.checkOut > today);
    if (late.length > 0) {
      out.push({ id: "late", icon: CalendarClock, title: plural(late.length, "late arrival", "late arrivals"), body: "Booked for an earlier date and not checked in yet.", to: "/reservations", tone: "warn" });
    }
    const inHouse = stays.data ?? [];
    const overdue = inHouse.filter((s) => istDate(s.expectedCheckOutAt) < today);
    if (overdue.length > 0) {
      out.push({ id: "overdue", icon: LogOut, title: plural(overdue.length, "checkout overdue", "checkouts overdue"), body: "Past the expected checkout date. Check out or extend.", to: "/", tone: "danger" });
    }
    const owing = inHouse.filter((s) => s.balance > 0);
    if (owing.length > 0) {
      const sum = owing.reduce((a, s) => a + s.balance, 0);
      out.push({ id: "balance", icon: IndianRupee, title: `${rupees(sum)} to collect`, body: `${plural(owing.length, "in-house guest has", "in-house guests have")} a balance due.`, to: "/", tone: "info" });
    }
  }
  const b = property.billing;
  if (b && canManage(role)) {
    if (b.state === "expired") out.push({ id: "plan", icon: AlertTriangle, title: "Gustlog plan expired", body: "The app is read-only until you renew.", to: "/billing", tone: "danger" });
    else if (b.state === "grace") out.push({ id: "plan", icon: AlertTriangle, title: "Gustlog plan ended", body: `Renew within ${plural(b.graceDaysLeft, "day", "days")} to avoid read-only mode.`, to: "/billing", tone: "warn" });
    else if (b.daysLeft <= 7) out.push({ id: "plan", icon: AlertTriangle, title: b.state === "trial" ? "Free trial ending" : "Plan renewal due", body: b.daysLeft === 0 ? "Ends today." : `${plural(b.daysLeft, "day", "days")} left.`, to: "/billing", tone: "info" });
  }
  return out;
}
