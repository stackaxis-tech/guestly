/**
 * One list of destinations drives the bottom nav, the Home quick actions and
 * the "More" sheet. Each entry says which roles may see it and where it
 * appears, so adding or hiding a feature is a one-line change here.
 */
import {
  BarChart3,
  BedDouble,
  CalendarDays,
  CalendarPlus,
  CreditCard,
  Home,
  LogIn,
  Settings,
  UserCheck,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { User } from "./api";

export type Role = User["role"];

/** Live counts that badges can show. */
export type BadgeContext = { cleaning: number; arrivals: number; dueOut: number };

export type MenuItem = {
  id: string;
  label: string;
  /** Shorter label for the bottom nav on phones. */
  short?: string;
  icon: LucideIcon;
  to: string;
  roles: readonly Role[];
  /** Exact match for NavLink (only "/"). */
  end?: boolean;
  /** Bottom nav. "desktop" entries show in the bar only on wide screens and go to More on phones. */
  nav?: "always" | "desktop";
  quick?: boolean;
  more?: boolean;
  /** The main action: drawn filled in quick actions. */
  primary?: boolean;
  badge?: (c: BadgeContext) => number;
};

const ALL: readonly Role[] = ["owner", "manager", "front_desk", "housekeeping"];
const DESK: readonly Role[] = ["owner", "manager", "front_desk"];
const MANAGERS: readonly Role[] = ["owner", "manager"];

export const menu: MenuItem[] = [
  { id: "home", label: "Today", short: "Home", icon: Home, to: "/", end: true, roles: ALL, nav: "always" },
  // Check-in is the floating button on Home, so it isn't repeated as a tile.
  { id: "check-in", label: "Check in", icon: LogIn, to: "/check-in", roles: DESK },
  { id: "booking", label: "New booking", icon: CalendarPlus, to: "/reservations?new=1", roles: DESK, quick: true },
  { id: "rooms", label: "Rooms", icon: BedDouble, to: "/rooms", roles: ALL, nav: "always", quick: true, badge: (c) => c.cleaning },
  { id: "reservations", label: "Reservations", short: "Bookings", icon: CalendarDays, to: "/reservations", roles: DESK, nav: "always" },
  { id: "guests", label: "Guests", icon: Users, to: "/guests", roles: DESK, nav: "always", quick: true },
  { id: "reports", label: "Reports", icon: BarChart3, to: "/reports", roles: MANAGERS, nav: "desktop", quick: true, more: true },
  { id: "staff", label: "Staff", icon: UserCheck, to: "/staff", roles: MANAGERS, nav: "desktop", quick: true, more: true },
  { id: "profile", label: "My profile", short: "Profile", icon: UserCircle, to: "/profile", roles: ALL, quick: true, more: true },
  { id: "settings", label: "Settings", icon: Settings, to: "/settings", roles: MANAGERS, more: true },
  { id: "billing", label: "Gustlog plan", icon: CreditCard, to: "/billing", roles: MANAGERS, more: true },
];

export function menuFor(role: Role | undefined, where: "nav" | "quick" | "more"): MenuItem[] {
  if (!role) return [];
  return menu.filter((m) => m.roles.includes(role) && (where === "nav" ? !!m.nav : m[where]));
}

/**
 * Quick actions for Home. Shows at most `max` tiles; when there are more,
 * the last slot becomes "All", which opens the More sheet.
 */
export function quickActionsFor(role: Role | undefined, max = 4): { shown: MenuItem[]; overflow: boolean } {
  const items = menuFor(role, "quick");
  if (items.length <= max) return { shown: items, overflow: false };
  return { shown: items.slice(0, max - 1), overflow: true };
}
