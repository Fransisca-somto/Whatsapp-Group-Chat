// Active authorized users with their groups (data-models.md §3.5–3.6). Read fresh for each
// reminder request, so a change on the dashboard applies to the next request.
import type { AuthorizedUser } from "../reminders/permission.ts";
import type { ServiceClient } from "./supabase.ts";

export type AuthorizedUserStore = { listActive(): Promise<AuthorizedUser[]> };

export function createAuthorizedUsersRepo(db: ServiceClient): AuthorizedUserStore {
  return {
    async listActive() {
      const { data, error } = await db
        .from("authorized_users")
        .select("phone_e164, all_groups, authorized_user_groups(group_id)")
        .eq("is_active", true);
      if (error) throw new Error(`authorized_users read failed: ${error.message}`);
      return data.map((row) => ({
        phoneE164: row.phone_e164,
        allGroups: row.all_groups,
        groupIds: row.authorized_user_groups.map((link) => link.group_id),
      }));
    },
  };
}
