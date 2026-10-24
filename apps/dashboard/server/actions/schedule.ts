"use server";

// Reminders and announcements for owner and staff (api-interfaces.md §3,
// Workflow/Phases/07-Scheduler.md). The worker posts them; these actions only create, change,
// cancel, resend or dismiss rows. Every change is conditional on the post's status, so a post
// the worker has already claimed can never be edited or cancelled under it.
import {
  ATTACHMENT_BUCKET,
  ATTENTION_STATUSES,
  repeatRuleToRrule,
  resolveDueAt,
  scheduledPostIdInputSchema,
  scheduledPostInputSchema,
  updateScheduledPostInputSchema,
  type Attachment,
  type ScheduledPostInput,
} from "@soft-agent-support/shared";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { auditDashboardAction } from "@/server/audit";
import { getAccessDecision } from "@/server/currentUser";

import type { ActionResult } from "./connection";

const NO_ACCESS = "You need dashboard access to manage reminders and announcements.";
/** P16: a paused group's posts wait until it is resumed. */
const SCHEDULABLE_GROUP_STATUSES = ["active", "paused"];

async function requireDashboardUser() {
  const access = await getAccessDecision();
  return access.kind === "allowed" ? access : null;
}

async function audit(input: Parameters<typeof auditDashboardAction>[0]) {
  try {
    await auditDashboardAction(input);
  } catch (error) {
    // The change itself succeeded; a missing audit row must not undo it.
    console.error("schedule action: audit write failed", error);
  }
}

function refresh(groupId: string) {
  revalidatePath("/schedule");
  revalidatePath("/");
  revalidatePath(`/groups/${groupId}`);
}

function firstIssue(error: { issues: { message: string }[] }, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The attachment columns for a post (all null without one). */
function attachmentColumns(attachment: Attachment | null) {
  return {
    attachment_path: attachment?.path ?? null,
    attachment_kind: attachment?.kind ?? null,
    attachment_mime: attachment?.mime ?? null,
    attachment_name: attachment?.name ?? null,
    attachment_size: attachment?.size ?? null,
    attachment_seconds: attachment?.seconds ?? null,
  };
}

/** Deletes a replaced or removed file if no other post (a series, a resend) still uses it. */
async function deleteIfUnused(supabase: Supabase, path: string) {
  const { count, error } = await supabase
    .from("scheduled_posts")
    .select("id", { count: "exact", head: true })
    .eq("attachment_path", path);
  if (error || (count ?? 0) > 0) return;
  const { error: removeError } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
  if (removeError) console.error("schedule: could not delete a replaced attachment", removeError);
}

/** Checks the group can take posts and works out the UTC time; an error message otherwise. */
async function prepare(
  supabase: Supabase,
  input: ScheduledPostInput,
): Promise<{ ok: true; dueAt: string; rrule: string | null } | { ok: false; error: string }> {
  const [groupResult, settingsResult] = await Promise.all([
    supabase.from("groups").select("status").eq("id", input.groupId).maybeSingle(),
    supabase.from("company_settings").select("timezone").eq("id", 1).maybeSingle(),
  ]);
  if (groupResult.error || settingsResult.error) {
    console.error("schedule: read failed", groupResult.error ?? settingsResult.error);
    return { ok: false, error: "Could not check the group. Please try again." };
  }
  if (!groupResult.data) return { ok: false, error: "That group no longer exists." };
  if (!SCHEDULABLE_GROUP_STATUSES.includes(groupResult.data.status)) {
    return { ok: false, error: "The bot can only post in active or paused groups." };
  }
  const timeZone = settingsResult.data?.timezone ?? "UTC";
  const due = resolveDueAt(input, timeZone, new Date());
  if (!due.ok) return due;
  return {
    ok: true,
    dueAt: due.dueAt.toISOString(),
    rrule: input.repeat ? repeatRuleToRrule(input.repeat) : null,
  };
}

export async function createScheduledPost(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = scheduledPostInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Check the post.") };
  const post = parsed.data;

  const supabase = await createClient();
  const prepared = await prepare(supabase, post);
  if (!prepared.ok) return prepared;

  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert({
      group_id: post.groupId,
      kind: post.kind,
      body: post.body,
      due_at: prepared.dueAt,
      recurrence_rule: prepared.rrule,
      created_via: "dashboard",
      created_by_user_id: user.userId,
      ...attachmentColumns(post.attachment),
    })
    .select("id")
    .single();
  if (error) {
    console.error("createScheduledPost: insert failed", error);
    return { ok: false, error: "Could not schedule the post. Please try again." };
  }

  await audit({
    userId: user.userId,
    action: "post_created",
    groupId: post.groupId,
    detail: {
      postId: data.id,
      kind: post.kind,
      dueAt: prepared.dueAt,
      repeat: prepared.rrule,
      characters: post.body.length,
      attachment: post.attachment?.kind ?? null,
    },
  });
  refresh(post.groupId);
  return { ok: true, data: { id: data.id } };
}

export async function updateScheduledPost(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = updateScheduledPostInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Check the post.") };
  const { id, ...post } = parsed.data;

  const supabase = await createClient();
  const prepared = await prepare(supabase, post);
  if (!prepared.ok) return prepared;
  const { data: before } = await supabase
    .from("scheduled_posts")
    .select("attachment_path")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({
      group_id: post.groupId,
      kind: post.kind,
      body: post.body,
      due_at: prepared.dueAt,
      recurrence_rule: prepared.rrule,
      ...attachmentColumns(post.attachment),
    })
    .eq("id", id)
    .eq("status", "scheduled")
    .select("id");
  if (error) {
    console.error("updateScheduledPost: update failed", error);
    return { ok: false, error: "Could not save the post. Please try again." };
  }
  if (data.length === 0) {
    return { ok: false, error: "This post is being sent or has already gone out." };
  }
  const oldPath = before?.attachment_path;
  if (oldPath && oldPath !== post.attachment?.path) await deleteIfUnused(supabase, oldPath);

  await audit({
    userId: user.userId,
    action: "post_updated",
    groupId: post.groupId,
    detail: {
      postId: id,
      kind: post.kind,
      dueAt: prepared.dueAt,
      repeat: prepared.rrule,
      characters: post.body.length,
    },
  });
  refresh(post.groupId);
  return { ok: true, data: undefined };
}

export async function cancelScheduledPost(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = scheduledPostIdInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown post." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.id)
    .eq("status", "scheduled")
    .select("id, group_id, kind, recurrence_rule");
  if (error) {
    console.error("cancelScheduledPost: update failed", error);
    return { ok: false, error: "Could not cancel the post. Please try again." };
  }
  const post = data[0];
  if (!post) return { ok: false, error: "This post is being sent or has already gone out." };

  await audit({
    userId: user.userId,
    action: "post_cancelled",
    groupId: post.group_id,
    detail: { postId: post.id, kind: post.kind, endedSeries: post.recurrence_rule !== null },
  });
  refresh(post.group_id);
  return { ok: true, data: undefined };
}

/**
 * Puts a failed, uncertain or skipped post back in the queue to go out on the next tick (P18).
 * A resent post is a one-off: its series has already moved on to the next date.
 */
export async function resendScheduledPost(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = scheduledPostIdInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown post." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({
      status: "scheduled",
      due_at: new Date().toISOString(),
      recurrence_rule: null,
      claim_token: null,
      claimed_at: null,
      last_error: null,
      dismissed_at: null,
    })
    .eq("id", parsed.data.id)
    .in("status", [...ATTENTION_STATUSES])
    .select("id, group_id, kind");
  if (error) {
    console.error("resendScheduledPost: update failed", error);
    return { ok: false, error: "Could not resend the post. Please try again." };
  }
  const post = data[0];
  if (!post) return { ok: false, error: "This post no longer needs attention." };

  await audit({
    userId: user.userId,
    action: "post_resent",
    groupId: post.group_id,
    detail: { postId: post.id, kind: post.kind },
  });
  refresh(post.group_id);
  return { ok: true, data: undefined };
}

/** Moves a post from Needs attention to History without sending it (P18). */
export async function dismissScheduledPost(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = scheduledPostIdInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown post." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduled_posts")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .in("status", [...ATTENTION_STATUSES])
    .is("dismissed_at", null)
    .select("id, group_id, kind, status");
  if (error) {
    console.error("dismissScheduledPost: update failed", error);
    return { ok: false, error: "Could not dismiss the post. Please try again." };
  }
  const post = data[0];
  if (!post) return { ok: false, error: "This post no longer needs attention." };

  await audit({
    userId: user.userId,
    action: "post_dismissed",
    groupId: post.group_id,
    detail: { postId: post.id, kind: post.kind, status: post.status },
  });
  refresh(post.group_id);
  return { ok: true, data: undefined };
}
