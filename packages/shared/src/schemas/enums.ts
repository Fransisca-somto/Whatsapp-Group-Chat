// Allowed values for status-like text columns. The database uses `check (... in (...))`
// constraints rather than Postgres enums, so these mirror supabase/migrations/0002-0004 and
// data-models.md §3. Keep them in sync when a migration changes a constraint.
import { z } from "zod";

export const dashboardRoleSchema = z.enum(["owner", "staff"]);
export type DashboardRole = z.infer<typeof dashboardRoleSchema>;

export const groupStatusSchema = z.enum(["pending", "active", "paused", "removed", "archived"]);
export type GroupStatus = z.infer<typeof groupStatusSchema>;

export const reminderPermissionSchema = z.enum(["admins_only", "any_member"]);
export type ReminderPermission = z.infer<typeof reminderPermissionSchema>;

export const knowledgeEmbeddingStatusSchema = z.enum(["pending", "done", "failed"]);
export type KnowledgeEmbeddingStatus = z.infer<typeof knowledgeEmbeddingStatusSchema>;

export const messageEmbeddingStatusSchema = z.enum(["pending", "done", "skipped", "failed"]);
export type MessageEmbeddingStatus = z.infer<typeof messageEmbeddingStatusSchema>;

export const messageTypeSchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "other",
]);
export type MessageType = z.infer<typeof messageTypeSchema>;

export const handledStatusSchema = z.enum([
  "received",
  "answered",
  "refused",
  "rate_limited",
  "failed",
]);
export type HandledStatus = z.infer<typeof handledStatusSchema>;

export const pendingReminderStatusSchema = z.enum([
  "awaiting",
  "confirmed",
  "declined",
  "expired",
  "superseded",
]);
export type PendingReminderStatus = z.infer<typeof pendingReminderStatusSchema>;

export const scheduledPostKindSchema = z.enum(["reminder", "announcement"]);
export type ScheduledPostKind = z.infer<typeof scheduledPostKindSchema>;

export const scheduledPostStatusSchema = z.enum([
  "scheduled",
  "sending",
  "sent",
  "failed",
  "delivery_uncertain",
  "skipped_late",
  "cancelled",
]);
export type ScheduledPostStatus = z.infer<typeof scheduledPostStatusSchema>;

export const createdViaSchema = z.enum(["dashboard", "group"]);
export type CreatedVia = z.infer<typeof createdViaSchema>;

export const actorTypeSchema = z.enum(["member", "authorized_user", "dashboard_user", "system"]);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const waConnectionStatusSchema = z.enum([
  "not_linked",
  "pairing",
  "connecting",
  "connected",
  "reconnecting",
  "logged_out",
  "conflict",
]);
export type WaConnectionStatus = z.infer<typeof waConnectionStatusSchema>;

export const pairingRequestKindSchema = z.enum(["pair", "relink"]);
export type PairingRequestKind = z.infer<typeof pairingRequestKindSchema>;

export const pairingRequestStatusSchema = z.enum([
  "requested",
  "code_issued",
  "paired",
  "expired",
  "failed",
  "cancelled",
]);
export type PairingRequestStatus = z.infer<typeof pairingRequestStatusSchema>;

export const alertKindSchema = z.enum(["logged_out", "offline", "reconnect_failures", "conflict"]);
export type AlertKind = z.infer<typeof alertKindSchema>;
