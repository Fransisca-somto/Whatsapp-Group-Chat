"use client";

import type * as React from "react";

import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { GROUP_TABS, type GroupTab } from "@/lib/groups";

const LABELS: Record<GroupTab, string> = {
  settings: "Settings",
  train: "Train",
  messages: "Messages",
};

/**
 * Settings · Train · Messages on the group page. The open tab is kept in `?tab=` so approving a
 * group can land on Train and a reload stays on the same tab.
 */
export function GroupTabs({
  initialTab,
  panels,
  badges,
}: {
  initialTab: GroupTab;
  panels: Record<GroupTab, React.ReactNode>;
  badges?: Partial<Record<GroupTab, React.ReactNode>>;
}) {
  return (
    <Tabs
      key={initialTab}
      defaultValue={initialTab}
      onValueChange={(value: GroupTab) => {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", value);
        window.history.replaceState(window.history.state, "", url);
      }}
    >
      <TabsList>
        {GROUP_TABS.map((tab) => (
          <TabsTab key={tab} value={tab}>
            {LABELS[tab]}
            {badges?.[tab]}
          </TabsTab>
        ))}
      </TabsList>
      {GROUP_TABS.map((tab) => (
        <TabsPanel key={tab} value={tab}>
          {panels[tab]}
        </TabsPanel>
      ))}
    </Tabs>
  );
}
