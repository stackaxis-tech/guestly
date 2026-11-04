import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type Property = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  gstin: string;
  googleReviewUrl: string;
  invoicePrefix: string;
  checkInTime: string;
  checkOutTime: string;
  logoUrl: string;
  frontDesk: {
    whatsappNumber: string;
    whatsappOpenIn: "app" | "web";
    wifiName: string;
    wifiPassword: string;
    gstRegistered: boolean;
    roomGstThreshold: number;
    roomGstLow: number;
    roomGstHigh: number;
    serviceGstRate: number;
  };
  subscription?: {
    id: string;
    plan: "monthly" | "annual" | "custom";
    amount: number;
    periodMonths: number;
    isTrial: boolean;
    startsOn: string;
    endsOn: string;
    graceDays: number;
  };
  billing?: { state: "trial" | "active" | "grace" | "expired"; daysLeft: number; graceDaysLeft: number; readOnly: boolean };
};

const STORAGE_KEY = "guestly.propertyId";

type Ctx = {
  properties: Property[];
  current: Property | null;
  select: (id: string) => void;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

const PropertyContext = createContext<Ctx | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Tracks which property the staff member is working in. The choice is remembered per device. */
export function PropertyProvider({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ["properties"], queryFn: () => api<Property[]>("/properties") });
  const [selectedId, setSelectedId] = useState<string | null>(readStored);

  const properties = useMemo(() => q.data ?? [], [q.data]);
  const current = properties.find((p) => p.id === selectedId) ?? properties[0] ?? null;

  useEffect(() => {
    if (!current) return;
    try {
      localStorage.setItem(STORAGE_KEY, current.id);
    } catch {
      /* storage unavailable: selection just won't persist */
    }
  }, [current]);

  return (
    <PropertyContext.Provider
      value={{
        properties,
        current,
        select: setSelectedId,
        isLoading: q.isLoading,
        error: q.error,
        refetch: () => void q.refetch(),
      }}
    >
      {children}
    </PropertyContext.Provider>
  );
}

export function useProperty() {
  const ctx = useContext(PropertyContext);
  if (!ctx) throw new Error("useProperty must be used inside PropertyProvider");
  return ctx;
}

/** The selected property. Only call below AppShell, which renders nothing until one is loaded. */
export function useCurrentProperty(): Property {
  const { current } = useProperty();
  if (!current) throw new Error("No property selected");
  return current;
}
