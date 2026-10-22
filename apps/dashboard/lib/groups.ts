// Shapes and labels shared by the group pages and their server actions.
import type { GroupAction, ReminderPermission } from "@soft-agent-support/shared";

export const GROUP_MESSAGES_PAGE = 50;

/** Tabs on the group page, kept in `?tab=`. Lives here, not in the client GroupTabs file, so the
 * server page can read it (a "use client" module only exports components to the server). */
export const GROUP_TABS = ["settings", "train", "messages"] as const;
export type GroupTab = (typeof GROUP_TABS)[number];

export const GROUP_MESSAGE_COLUMNS =
  "id, sender_name, sender_phone_e164, body, message_type, sent_at, mentions_bot, is_from_bot";

export type GroupMessageView = {
  id: string;
  sender_name: string | null;
  sender_phone_e164: string | null;
  body: string | null;
  message_type: string;
  sent_at: string;
  mentions_bot: boolean;
  is_from_bot: boolean;
};

export const REMINDER_PERMISSION_LABELS: Record<ReminderPermission, string> = {
  admins_only: "Authorized users only",
  any_member: "Any member",
};

export const GROUP_ACTION_LABELS: Record<GroupAction, string> = {
  approve: "Approve",
  pause: "Pause",
  resume: "Resume",
  archive: "Archive",
};

/** What a media message without a caption shows in the message list. */
export const MEDIA_PLACEHOLDER: Record<string, string> = {
  image: "Photo",
  video: "Video",
  audio: "Voice note / audio",
  document: "Document",
  sticker: "Sticker",
  other: "Unsupported message",
};
