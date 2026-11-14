import {
  Building2,
  CalendarClock,
  GraduationCap,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  ownerOnly: boolean;
  /** Shown only to platform admins (ADR-039). */
  platformAdminOnly?: boolean;
};

/** Sidebar order and labels from ui-context.md §3. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, ownerOnly: false },
  { href: "/groups", label: "Groups", icon: Users, ownerOnly: false },
  { href: "/schedule", label: "Reminders & announcements", icon: CalendarClock, ownerOnly: false },
  { href: "/knowledge", label: "Training", icon: GraduationCap, ownerOnly: false },
  { href: "/authorized-users", label: "Authorized users", icon: ShieldCheck, ownerOnly: false },
  { href: "/connection", label: "Connection", icon: Smartphone, ownerOnly: true },
  { href: "/audit", label: "Audit log", icon: ScrollText, ownerOnly: false },
  { href: "/settings", label: "Settings", icon: Settings, ownerOnly: true },
  { href: "/team", label: "Team", icon: UserCog, ownerOnly: true },
  {
    href: "/admin",
    label: "Companies (admin)",
    icon: Building2,
    ownerOnly: false,
    platformAdminOnly: true,
  },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.href === "/"
    ? pathname === "/"
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
