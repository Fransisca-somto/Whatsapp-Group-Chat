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

type AppShellProps = {
  user: { displayName: string; role: DashboardRole };
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
export function AppShell({ user, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const pageTitle = NAV_ITEMS.find((item) => isNavItemActive(item, pathname))?.label ?? "";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-surface px-4">
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
        {/* Live <WorkerStatus /> arrives with task 1.6. */}
        <div data-slot="worker-status" className="hidden text-xs text-muted-foreground sm:block">
          Worker status: not available yet
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
          <SidebarNav role={user.role} onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r bg-surface md:block">
          <SidebarNav role={user.role} />
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
