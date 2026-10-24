// Post attachments in Supabase Storage (bucket `post-attachments`, migration 0014). The worker
// reads files to send them and deletes files no post needs any more (Phase 6, 6.8–6.9).
import { ATTACHMENT_BUCKET } from "@soft-agent-support/shared";

import type { ServiceClient } from "./supabase.ts";

export type AttachmentsStore = {
  download(path: string): Promise<Buffer>;
  /** attachments_due_for_cleanup(): files every post has finished with (P30). */
  dueForCleanup(limit: number): Promise<string[]>;
  /** Deletes the files and records it on the posts; returns the posts' ids. */
  remove(paths: string[]): Promise<{ id: string; groupId: string; kind: string | null }[]>;
};

export function createAttachmentsStore(db: ServiceClient): AttachmentsStore {
  return {
    async download(path) {
      const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).download(path);
      if (error) throw new Error(`attachment download failed: ${error.message}`);
      return Buffer.from(await data.arrayBuffer());
    },

    async dueForCleanup(limit) {
      const { data, error } = await db.rpc("attachments_due_for_cleanup", { p_limit: limit });
      if (error) throw new Error(`attachments_due_for_cleanup failed: ${error.message}`);
      return data.map((row) => row.attachment_path);
    },

    async remove(paths) {
      if (paths.length === 0) return [];
      const { error } = await db.storage.from(ATTACHMENT_BUCKET).remove(paths);
      if (error) throw new Error(`attachment delete failed: ${error.message}`);
      const { data, error: updateError } = await db
        .from("scheduled_posts")
        .update({ attachment_deleted_at: new Date().toISOString() })
        .in("attachment_path", paths)
        .is("attachment_deleted_at", null)
        .select("id, group_id, attachment_kind");
      if (updateError) throw new Error(`scheduled_posts update failed: ${updateError.message}`);
      return data.map((row) => ({ id: row.id, groupId: row.group_id, kind: row.attachment_kind }));
    },
  };
}
