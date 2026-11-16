import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, hotel, type Session, type User } from "./api";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "signedOut"; user: null }
  | { status: "signedIn"; user: User };

type RegisterData = {
  hotelName: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  acceptedTerms: boolean;
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  acceptInvite: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });
  const qc = useQueryClient();

  const signedOut = useCallback(() => {
    hotel.setToken(null);
    qc.clear();
    setState({ status: "signedOut", user: null });
  }, [qc]);

  useEffect(() => {
    hotel.onSessionEnd(signedOut);
    hotel.refresh().then((s) => {
      setState(s ? { status: "signedIn", user: s.user } : { status: "signedOut", user: null });
    });
  }, [signedOut]);

  const start = async (s: Session) => {
    await hotel.adopt(s);
    setState({ status: "signedIn", user: s.user });
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login: async (email, password) => start(await api<Session>("/auth/login", { method: "POST", body: { email, password } })),
      register: async (data: RegisterData) => start(await api<Session>("/auth/register", { method: "POST", body: data })),
      acceptInvite: async (token, password) =>
        start(await api<Session>(`/invites/${token}/accept`, { method: "POST", body: { password } })),
      logout: async () => {
        await hotel.logout();
        signedOut();
      },
    }),
    [state, signedOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export const roleLabel: Record<User["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  front_desk: "Front desk",
  housekeeping: "Housekeeping",
};

export function canManage(role: User["role"] | undefined) {
  return role === "owner" || role === "manager";
}
