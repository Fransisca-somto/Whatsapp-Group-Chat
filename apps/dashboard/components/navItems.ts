import {
  BookOpen,
  CalendarClock,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  ownerOnly: boolean;
};

/** Sidebar order and labels from ui-context.md §3. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, ownerOnly: false },
  { href: "/groups", label: "Groups", icon: Users, ownerOnly: false },
  { href: "/schedule", label: "Reminders & announcements", icon: CalendarClock, ownerOnly: false },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen, ownerOnly: false },
  { href: "/authorized-users", label: "Authorized users", icon: ShieldCheck, ownerOnly: false },
  { href: "/connection", label: "Connection", icon: Smartphone, ownerOnly: true },
  { href: "/audit", label: "Audit log", icon: ScrollText, ownerOnly: false },
  { href: "/settings", label: "Settings", icon: Settings, ownerOnly: true },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.href === "/"
    ? pathname === "/"
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
