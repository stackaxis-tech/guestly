import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { PayMode } from "./stays";

export type ReportInvoice = {
  id: string;
  stayId: string;
  number: string;
  issuedAt: string;
  guest: string;
  billTo: string;
  room: string;
  total: number;
  paid: number;
};

export type Report = {
  from: string;
  to: string;
  days: number;
  rooms: number;
  roomNights: number;
  occupancyPct: number;
  avgRate: number;
  invoiceCount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  invoiced: number;
  collected: number;
  payments: { mode: PayMode; amount: number }[];
  gst: { month: string; rateBp: number; taxable: number; cgst: number; sgst: number; invoices: number }[];
  invoices: ReportInvoice[];
  dues: ReportInvoice[];
};

export const useReport = (propertyId: string, from: string, to: string) =>
  useQuery({
    queryKey: ["report", propertyId, from, to],
    queryFn: () => api<Report>(`/properties/${propertyId}/reports?from=${from}&to=${to}`),
    enabled: from !== "" && to !== "" && from <= to,
    staleTime: 0,
  });

/** Downloads rows as a CSV file. Amounts are written in rupees so they open cleanly in Excel. */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const rupeeNumber = (paise: number) => (paise / 100).toFixed(2);

export type AttendanceRecord = {
  id: string;
  propertyId: string;
  userId: string;
  staffName: string;
  staffEmail: string;
  staffPhone: string;
  staffRole: string;
  date: string;
  clockInAt: string;
  clockOutAt: string | null;
  status: "present" | "half_day" | "on_leave" | "absent";
  notes: string;
  createdAt: string;
};

export type AttendanceReport = {
  records: AttendanceRecord[];
  summary: {
    totalStaff: number;
    presentToday: number;
    totalRecords: number;
  };
};

export type StaffMember = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  createdAt: string;
  attendanceToday?: AttendanceRecord;
  daysPresent: number;
};

export const useAttendanceReport = (propertyId: string, from: string, to: string, userId?: string) =>
  useQuery({
    queryKey: ["attendance-report", propertyId, from, to, userId],
    queryFn: () =>
      api<AttendanceReport>(
        `/properties/${propertyId}/attendance?from=${from}&to=${to}${userId ? `&userId=${userId}` : ""}`,
      ).then((r) => ({ ...r, records: r.records ?? [] })), // older servers send null when there are none
    enabled: !!propertyId && from !== "" && to !== "",
    staleTime: 10_000,
  });

export const useStaffList = (propertyId: string) =>
  useQuery({
    queryKey: ["staff-list", propertyId],
    queryFn: () => api<StaffMember[]>(`/properties/${propertyId}/staff`),
    enabled: !!propertyId,
    staleTime: 10_000,
  });

export const useStaffProfile = (propertyId: string) =>
  useQuery({
    queryKey: ["staff-profile", propertyId],
    queryFn: () => api<{ staff: StaffMember; history: AttendanceRecord[] }>(`/properties/${propertyId}/staff/me`),
    enabled: !!propertyId,
    staleTime: 5_000,
  });
