import { useQuery } from "@tanstack/react-query";
import { api, hotel } from "./api";

export type Guest = {
  id: string;
  name: string;
  phone: string;
  email: string;
  nationality: string;
  gender: string;
  birthYear: number | null;
  address: string;
  hasPhoto: boolean;
  whatsappConsent: boolean;
  stayCount: number;
  lastStayAt: string | null;
  createdAt: string;
};

export type DocType = "aadhaar" | "passport" | "driving_licence" | "voter_id" | "other";

export type GuestDocument = {
  id: string;
  type: DocType;
  numberLast4: string;
  hasNumber: boolean;
  hasFront: boolean;
  hasBack: boolean;
  visaExpiry: string | null;
  createdAt: string;
};

export type StaySummary = {
  id: string;
  status: "in_house" | "checked_out" | "cancelled";
  roomId: string;
  roomNumber: string;
  roomType: string;
  guestId: string;
  guestName: string;
  guestPhone: string;
  adults: number;
  children: number;
  nightlyRate: number;
  checkInAt: string;
  expectedCheckOutAt: string;
  checkedOutAt: string | null;
  nights: number | null;
  paid: number;
};

export type BillLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  taxable: number;
  gstRateBp: number;
  cgst: number;
  sgst: number;
  total: number;
  chargeId?: string;
};

export type Bill = {
  lines: BillLine[];
  taxable: number;
  cgst: number;
  sgst: number;
  total: number;
  paid: number;
  balance: number;
  nights: number;
  estimate: boolean;
};

export type StayPayment = {
  id: string;
  amount: number;
  mode: PayMode;
  reference: string;
  isAdvance: boolean;
  receivedBy: string;
  createdAt: string;
};

export type StayDetail = StaySummary & {
  purpose: string;
  comingFrom: string;
  goingTo: string;
  notes: string;
  guest: Guest;
  documents: GuestDocument[];
  companions: Guest[];
  charges: { id: string; description: string; quantity: number; unitPrice: number; gstRate: number; chargedOn: string }[];
  payments: StayPayment[];
  bill: Bill;
  messages: { kind: string; phone: string; status: "sent" | "skipped"; userName: string; createdAt: string }[];
};

export type PayMode = "cash" | "upi" | "card" | "bank" | "other";
export const payModeLabel: Record<PayMode, string> = { cash: "Cash", upi: "UPI", card: "Card", bank: "Bank transfer", other: "Other" };

export const docTypeLabel: Record<DocType, string> = {
  aadhaar: "Aadhaar",
  passport: "Passport",
  driving_licence: "Driving licence",
  voter_id: "Voter ID",
  other: "Other ID",
};

export const useStays = (propertyId: string, status: "in_house" | "checked_out" = "in_house") =>
  useQuery({ queryKey: ["stays", propertyId, status], queryFn: () => api<StaySummary[]>(`/properties/${propertyId}/stays?status=${status}`) });

export const useStay = (propertyId: string, id: string) =>
  useQuery({ queryKey: ["stay", propertyId, id], queryFn: () => api<StayDetail>(`/properties/${propertyId}/stays/${id}`) });

/** Uploads an image for check-in; the server encrypts it. Returns the staged upload ID. */
export async function uploadGuestImage(propertyId: string, file: Blob, kind: "photo" | "id_front" | "id_back"): Promise<string> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file, `${kind}.jpg`);
  const r = await api<{ id: string }>(`/properties/${propertyId}/uploads`, { method: "POST", form: fd });
  return r.id;
}

export type AadhaarDetails = { name: string; gender: string; birthYear: number | null; address: string; last4: string };

/** Reads the QR on an Aadhaar photo. The server keeps neither the image nor the result. */
export function scanAadhaar(propertyId: string, file: Blob): Promise<AadhaarDetails> {
  const fd = new FormData();
  fd.append("file", file, "aadhaar.jpg");
  return api<AadhaarDetails>(`/properties/${propertyId}/guests/scan-aadhaar`, { method: "POST", form: fd });
}

/** Loads an encrypted guest image as an object URL. Caller must revoke it. */
export async function loadSecureImage(path: string): Promise<string> {
  return URL.createObjectURL(await hotel.blob(path));
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** Shows +919847012345 as +91 98470 12345. */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

export const COUNTRIES: [string, string][] = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"],
  ["QA", "Qatar"], ["OM", "Oman"], ["KW", "Kuwait"], ["BH", "Bahrain"], ["DE", "Germany"], ["FR", "France"], ["IT", "Italy"],
  ["ES", "Spain"], ["NL", "Netherlands"], ["RU", "Russia"], ["IL", "Israel"], ["AU", "Australia"], ["NZ", "New Zealand"],
  ["CA", "Canada"], ["SG", "Singapore"], ["MY", "Malaysia"], ["JP", "Japan"], ["CN", "China"], ["KR", "South Korea"],
  ["LK", "Sri Lanka"], ["MV", "Maldives"], ["NP", "Nepal"], ["BD", "Bangladesh"], ["OT", "Other"],
];
