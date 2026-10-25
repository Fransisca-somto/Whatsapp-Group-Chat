-- 0015: groups come back on their own after a number change (Phase 7, task 7.1,
-- Workflow/Phases/10-Hardening.md P38; ADR-038).
--
-- When the owner relinks (a new number), the worker records each active or paused group's status.
-- Groups the new number isn't in become `removed` as before; when the new number is added to one
-- within 30 days, it returns to the recorded status without re-approval. The dashboard lists the
-- groups still waiting (status `removed` with `relinked_at` set).

alter table public.groups
  add column status_before_relink text
    check (status_before_relink is null or status_before_relink in ('active', 'paused')),
  add column relinked_at timestamptz;

alter table public.groups
  add constraint groups_relink_marks_together
    check ((status_before_relink is null) = (relinked_at is null));
