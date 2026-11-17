import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { PayMode } from "./stays";

export type Reservation = {
  id: string;
  status: "booked" | "checked_in" | "cancelled" | "no_show";
  roomId: string;
  roomNumber: string;
  roomType: string;
  guestName: string;
  guestPhone: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  adults: number;
  children: number;
  nightlyRate: number;
  advanceAmount: number;
  advanceMode: PayMode | null;
  advanceReference: string;
  notes: string;
  whatsappConsent: boolean;
  stayId: string | null;
  cancelReason: string;
  createdAt: string;
  confirmationSent: boolean;
};

export type AvailableRoom = { id: string; number: string; floor: number; typeName: string; bedType: string; baseRate: number };

/** A local calendar date as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today's date at the hotel (India), whatever time zone this device is set to. */
export function hotelToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** The hotel's (India's) current date and HH:MM time, whatever time zone this device is set to. */
export function hotelNow(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** An India date + HH:MM as an absolute instant (ISO), correct on a device in any time zone. */
export function hotelInstant(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00+05:30`).toISOString();
}

/** The India calendar date of an instant. */
export function hotelDateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** "Wed 19 Nov, 7:40 PM" in India time. */
export function hotelDateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * The hotel night a walk-in arriving now belongs to. Under a fixed checkout
 * time, arriving before the cutoff (say 2 AM, cutoff 6 AM) takes the night
 * that has already begun. Mirrors ArrivalNight in backend/internal/stay/bill.go.
 */
export function arrivalNight(now: { date: string; time: string }, cutoff: string, policy: "fixed" | "24h"): string {
  return policy === "fixed" && now.time < cutoff ? addDays(now.date, -1) : now.date;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export function nightsBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000);
}

export function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export const useReservations = (propertyId: string, from: string, to: string, enabled = true) =>
  useQuery({
    queryKey: ["reservations", propertyId, from, to],
    queryFn: () => api<Reservation[]>(`/properties/${propertyId}/reservations?from=${from}&to=${to}`),
    enabled,
  });

export const useReservation = (propertyId: string, id: string | null) =>
  useQuery({
    queryKey: ["reservation", propertyId, id],
    queryFn: () => api<Reservation>(`/properties/${propertyId}/reservations/${id}`),
    enabled: !!id,
  });

export function useInvalidateBookings(propertyId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["reservations", propertyId] });
    void qc.invalidateQueries({ queryKey: ["reservation", propertyId] });
    void qc.invalidateQueries({ queryKey: ["rooms", propertyId] });
  };
}
