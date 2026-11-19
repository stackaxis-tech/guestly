import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AdminShell, AdminLogin } from "./admin/AdminShell";
import { ActivityPage, AdminDashboard, AdminPaymentsPage, ClientsPage } from "./admin/AdminPages";
import { ClientDetailPage } from "./admin/ClientDetailPage";
import { AdminAuthProvider, useAdminAuth } from "./admin/lib";
import { NewClientPage } from "./admin/NewClientPage";
import { AppShell } from "./components/AppShell";
import { LogoMark } from "./components/brand/Logo";
import { ApiError } from "./lib/api";
import { isNative } from "./lib/platform";
import { AuthProvider, useAuth } from "./lib/auth";
import { PropertyProvider } from "./lib/property";
import { AuthPage } from "./pages/AuthPage";
import { RegisterPage } from "./pages/RegisterPage";
import { InvitePage } from "./pages/InvitePage";
import { ReservationsPage } from "./pages/ReservationsPage";
import { RoomsPage } from "./pages/RoomsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { CheckInPage } from "./pages/CheckInPage";
import { GuestDetailPage, GuestsPage } from "./pages/GuestsPage";
import { StayPage } from "./pages/StayPage";
import { InvoicePage, PublicInvoicePage } from "./pages/InvoicePage";
import { PublicReceiptPage } from "./pages/ReceiptPage";
import { ReportsPage } from "./pages/ReportsPage";
import { TodayPage } from "./pages/TodayPage";
import { BillingPage } from "./pages/BillingPage";
import { StaffProfilePage } from "./pages/StaffProfilePage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading Gustlog">
      <LogoMark size={44} className="animate-pulse" />
    </div>
  );
}

/* ---------- Hotel staff app ---------- */

function HotelApp() {
  const { status } = useAuth();
  if (status === "loading") return <Splash />;

  if (status === "signedOut") {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <PropertyProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<TodayPage />} />
          <Route path="rooms" element={<RoomsPage />} />
          <Route path="check-in" element={<CheckInPage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="stays/:stayId" element={<StayPage />} />
          <Route path="stays/:stayId/invoice" element={<InvoicePage />} />
          <Route path="guests" element={<GuestsPage />} />
          <Route path="guests/:guestId" element={<GuestDetailPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="profile" element={<StaffProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="billing" element={<BillingPage />} />
        </Route>
        {/* A signed-in user opening an invite (e.g. someone else's) is sent home. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PropertyProvider>
  );
}

/* ---------- Gustlog admin console ---------- */

function AdminApp() {
  const { status } = useAdminAuth();
  if (status === "loading") return <Splash />;
  if (status === "signedOut") return <AdminLogin />;
  return (
    <Routes>
      <Route path="/admin" element={<AdminShell />}>
        <Route index element={<AdminDashboard />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/new" element={<NewClientPage />} />
        <Route path="clients/:clientId" element={<ClientDetailPage />} />
        <Route path="payments" element={<AdminPaymentsPage />} />
        <Route path="activity" element={<ActivityPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

function Root() {
  const { pathname } = useLocation();
  // A guest's invoice link (/i/) and a client's payment receipt link (/p/) work without signing in.
  if (pathname.startsWith("/i/") || pathname.startsWith("/p/")) {
    return (
      <Routes>
        <Route path="/i/:token" element={<PublicInvoicePage />} />
        <Route path="/p/:token" element={<PublicReceiptPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }
  // The super admin console is web-only.
  if (!isNative && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    return (
      <AdminAuthProvider>
        <AdminApp />
      </AdminAuthProvider>
    );
  }
  return (
    <AuthProvider>
      <HotelApp />
    </AuthProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
