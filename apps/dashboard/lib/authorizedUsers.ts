// Shapes for the Authorized users page (ui-context.md §4 `/authorized-users`).

export const AUTHORIZED_USER_COLUMNS =
  "id, display_name, phone_e164, all_groups, is_active, authorized_user_groups(group_id)";

export type AuthorizedUserView = {
  id: string;
  display_name: string;
  phone_e164: string;
  all_groups: boolean;
  is_active: boolean;
  authorized_user_groups: { group_id: string }[];
};

/** A group an authorized user can be limited to. */
export type GroupOption = { id: string; name: string };

/** "All groups", or the chosen groups' names. */
export function groupsLabel(user: AuthorizedUserView, groups: GroupOption[]): string {
  if (user.all_groups) return "All groups";
  const names = user.authorized_user_groups
    .map((link) => groups.find((g) => g.id === link.group_id)?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));
  return names.length > 0 ? names.join(", ") : "No groups";
}
