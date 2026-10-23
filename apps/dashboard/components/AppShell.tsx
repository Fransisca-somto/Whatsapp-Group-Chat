"use client";

import { Menu, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type * as React from "react";

import type { DashboardRole } from "@soft-agent-support/shared";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import { isNavItemActive, NAV_ITEMS } from "./navItems";
import { SidebarNav } from "./Sidebar";
import { UserMenu } from "./UserMenu";
import { WorkerStatus } from "./WorkerStatus";

type AppShellProps = {
  user: { displayName: string; role: DashboardRole };
  /** Counts shown next to sidebar links, by href (e.g. posts needing attention). */
  navBadges?: Record<string, number>;
  children: React.ReactNode;
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold">
      <MessagesSquare aria-hidden="true" className="size-5 text-primary" />
      <span>Group Assistant</span>
    </Link>
  );
}

/** Top bar, sidebar (drawer below md) and page frame from ui-context.md §3. */
export function AppShell({ user, navBadges, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const pageTitle = NAV_ITEMS.find((item) => isNavItemActive(item, pathname))?.label ?? "";

  return (
    // Pinned to the browser window (fixed, edge to edge): the window's own scrolling can never
    // move it. The sidebar and the page content scroll on their own, so the top bar and sidebar
    // always stay in place and pages can fill the screen (the group chat).
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <header className="z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-surface px-4">
        <button
          type="button"
          className="rounded-md p-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:hidden"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu aria-hidden="true" className="size-5" />
          <span className="sr-only">Open navigation</span>
        </button>
        <div className="hidden md:block md:w-52">
          <Logo />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
          {pageTitle}
        </span>
        <div data-slot="worker-status">
          <WorkerStatus />
        </div>
        <UserMenu displayName={user.displayName} role={user.role} />
      </header>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left">
          <div className="border-b p-4">
            <SheetTitle render={<div />}>
              <Logo />
            </SheetTitle>
          </div>
          <SidebarNav role={user.role} badges={navBadges} onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r bg-surface md:block">
          <SidebarNav role={user.role} badges={navBadges} />
        </aside>
        <main data-page-scroll className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
