"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { DashboardRole } from "@soft-agent-support/shared";

import { cn } from "@/lib/utils";

import { isNavItemActive, NAV_ITEMS } from "./navItems";

type SidebarNavProps = {
  role: DashboardRole;
  /** Counts shown next to links, by href; 0 or missing shows nothing. */
  badges?: Record<string, number>;
  /** Called after a link is chosen, so the mobile drawer can close. */
  onNavigate?: () => void;
};

/** Navigation links. Owner-only items are hidden for staff; RLS and server actions still enforce access. */
export function SidebarNav({ role, badges, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => role === "owner" || !item.ownerOnly);

  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        const count = badges?.[item.href] ?? 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {count > 0 && (
              <span className="rounded-full bg-status-warn/15 px-1.5 text-xs font-semibold text-status-warn">
                {count}
                <span className="sr-only"> need attention</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
