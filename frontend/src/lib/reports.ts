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
