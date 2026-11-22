/**
 * A staff member's picture: one icon per role, never initials or photos, so
 * every person on a team reads the same way. Owner = the keys, manager = the
 * briefcase, front desk = the reception bell, housekeeping = the brush.
 */
import clsx from "clsx";
import { BriefcaseBusiness, BrushCleaning, ConciergeBell, KeyRound, UserRound, type LucideIcon } from "lucide-react";
import type { User } from "../lib/api";
import { roleLabel } from "../lib/auth";

type Role = User["role"];

const roleLook: Record<Role, { icon: LucideIcon; tone: string }> = {
  owner: { icon: KeyRound, tone: "bg-ink text-white" },
  manager: { icon: BriefcaseBusiness, tone: "bg-brand-50 text-brand-700" },
  front_desk: { icon: ConciergeBell, tone: "bg-ready-bg text-ready" },
  housekeeping: { icon: BrushCleaning, tone: "bg-cleaning-bg text-cleaning" },
};

const sizes = { sm: ["size-9", "size-[18px]"], md: ["size-11", "size-5"], lg: ["size-16", "size-7"] } as const;

export function RoleAvatar({ role, size = "md", className }: { role: string; size?: keyof typeof sizes; className?: string }) {
  const look = roleLook[role as Role] ?? { icon: UserRound, tone: "bg-sand text-ink-soft" };
  const [box, icon] = sizes[size];
  const label = roleLabel[role as Role] ?? "Staff";
  return (
    <span role="img" aria-label={label} title={label} className={clsx("flex shrink-0 items-center justify-center rounded-full", box, look.tone, className)}>
      <look.icon className={icon} strokeWidth={1.9} aria-hidden />
    </span>
  );
}
