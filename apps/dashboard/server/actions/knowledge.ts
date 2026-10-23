"use server";

// Per-group training actions for owner and staff (api-interfaces.md §3, ADR-026). Every write
// is scoped to one group: an entry is only ever read, changed or deleted together with the
// group it belongs to. The worker reads training fresh for each question.
import {
  copyTrainingInputSchema,
  deleteTrainingEntryInputSchema,
  importTrainingInputSchema,
  setTrainingEntryActiveInputSchema,
  updateBotInstructionsInputSchema,
  upsertTrainingEntryInputSchema,
} from "@soft-agent-support/shared";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { auditDashboardAction } from "@/server/audit";
import { getAccessDecision } from "@/server/currentUser";

import type { ActionResult } from "./connection";

const NO_ACCESS = "You need dashboard access to change training.";

async function requireDashboardUser() {
  const access = await getAccessDecision();
  return access.kind === "allowed" ? access : null;
}

async function audit(input: Parameters<typeof auditDashboardAction>[0]) {
  try {
    await auditDashboardAction(input);
  } catch (error) {
    // The change itself succeeded; a missing audit row must not undo it.
    console.error("training action: audit write failed", error);
  }
}

function refresh(groupId: string) {
  revalidatePath(`/groups/${groupId}`);
  revalidatePath("/groups");
  revalidatePath("/knowledge");
}

function firstIssue(error: { issues: { message: string }[] }, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

export async function upsertTrainingEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = upsertTrainingEntryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Check the entry.") };
  const { id, groupId, title, content, isActive } = parsed.data;

  const supabase = await createClient();
  const values = { title, content, is_active: isActive, updated_by: user.userId };
  const { data, error } = id
    ? await supabase
        .from("knowledge_entries")
        .update(values)
        .eq("id", id)
        .eq("group_id", groupId)
        .select("id")
    : await supabase
        .from("knowledge_entries")
        .insert({ ...values, group_id: groupId })
        .select("id");
  if (error) {
    console.error("upsertTrainingEntry: write failed", error);
    return { ok: false, error: "Could not save the training. Please try again." };
  }
  const saved = data[0];
  if (!saved) return { ok: false, error: "That entry no longer exists." };

  await audit({
    userId: user.userId,
    action: id ? "training_updated" : "training_added",
    groupId,
    detail: { entryId: saved.id, title, isActive, characters: content.length },
  });
  refresh(groupId);
  return { ok: true, data: { id: saved.id } };
}

export async function setTrainingEntryActive(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = setTrainingEntryActiveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown training entry." };
  const { id, groupId, isActive } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_entries")
    .update({ is_active: isActive, updated_by: user.userId })
    .eq("id", id)
    .eq("group_id", groupId)
    .select("id, title");
  if (error) {
    console.error("setTrainingEntryActive: update failed", error);
    return { ok: false, error: "Could not update the entry. Please try again." };
  }
  const entry = data[0];
  if (!entry) return { ok: false, error: "That entry no longer exists." };

  await audit({
    userId: user.userId,
    action: "training_updated",
    groupId,
    detail: { entryId: id, title: entry.title, isActive },
  });
  refresh(groupId);
  return { ok: true, data: undefined };
}

export async function deleteTrainingEntry(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = deleteTrainingEntryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown training entry." };
  const { id, groupId } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_entries")
    .delete()
    .eq("id", id)
    .eq("group_id", groupId)
    .select("id, title");
  if (error) {
    console.error("deleteTrainingEntry: delete failed", error);
    return { ok: false, error: "Could not delete the entry. Please try again." };
  }
  const entry = data[0];
  if (!entry) return { ok: false, error: "That entry was already deleted." };

  await audit({
    userId: user.userId,
    action: "training_deleted",
    groupId,
    detail: { entryId: id, title: entry.title },
  });
  refresh(groupId);
  return { ok: true, data: undefined };
}

export async function importTraining(input: unknown): Promise<ActionResult<{ count: number }>> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = importTrainingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Check the entries.") };
  const { groupId, entries } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_entries")
    .insert(
      entries.map((entry) => ({
        group_id: groupId,
        title: entry.title,
        content: entry.content,
        updated_by: user.userId,
      })),
    )
    .select("id");
  if (error) {
    console.error("importTraining: insert failed", error);
    return { ok: false, error: "Could not import the training. Please try again." };
  }

  await audit({
    userId: user.userId,
    action: "training_imported",
    groupId,
    detail: { count: data.length, titles: entries.slice(0, 20).map((entry) => entry.title) },
  });
  refresh(groupId);
  return { ok: true, data: { count: data.length } };
}

export async function copyTraining(input: unknown): Promise<ActionResult<{ count: number }>> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = copyTrainingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error, "Pick a group.") };
  const { fromGroupId, toGroupId } = parsed.data;

  const supabase = await createClient();
  const { data: source, error: readError } = await supabase
    .from("knowledge_entries")
    .select("title, content, is_active")
    .eq("group_id", fromGroupId)
    .order("created_at");
  if (readError) {
    console.error("copyTraining: read failed", readError);
    return { ok: false, error: "Could not read the other group's training. Please try again." };
  }
  if (source.length === 0) return { ok: false, error: "That group has no training to copy." };

  const { data, error } = await supabase
    .from("knowledge_entries")
    .insert(
      source.map((entry) => ({
        group_id: toGroupId,
        title: entry.title,
        content: entry.content,
        is_active: entry.is_active,
        updated_by: user.userId,
      })),
    )
    .select("id");
  if (error) {
    console.error("copyTraining: insert failed", error);
    return { ok: false, error: "Could not copy the training. Please try again." };
  }

  await audit({
    userId: user.userId,
    action: "training_copied",
    groupId: toGroupId,
    detail: { fromGroupId, count: data.length },
  });
  refresh(toGroupId);
  return { ok: true, data: { count: data.length } };
}

export async function updateBotInstructions(input: unknown): Promise<ActionResult> {
  const user = await requireDashboardUser();
  if (!user) return { ok: false, error: NO_ACCESS };

  const parsed = updateBotInstructionsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error, "Check the instructions.") };
  }
  const { groupId, instructions } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ bot_instructions: instructions })
    .eq("id", groupId)
    .select("id");
  if (error) {
    console.error("updateBotInstructions: update failed", error);
    return { ok: false, error: "Could not save the instructions. Please try again." };
  }
  if (data.length === 0) return { ok: false, error: "That group no longer exists." };

  await audit({
    userId: user.userId,
    action: "bot_instructions_updated",
    groupId,
    detail: { characters: instructions?.length ?? 0 },
  });
  refresh(groupId);
  return { ok: true, data: undefined };
}
