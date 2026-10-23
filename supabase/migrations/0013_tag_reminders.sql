-- 0013: reminders created by tagging the bot (Phase 6, Workflow/Phases/08-Tag-Reminders.md;
-- ADR-035).
--
-- 1. confirm_reminder_request(): the requester's "yes" confirms the request and creates the
--    reminder in one step (P22). A double "yes", a late "yes" or someone else's "yes" creates
--    nothing.
-- 2. Reminder text 1–500 characters.

alter table public.pending_reminder_requests
  add constraint pending_reminder_requests_body_length
  check (char_length(draft_body) between 1 and 500);

-- Returns the new scheduled_posts id, or null when there was nothing to confirm (not awaiting,
-- expired, or not this requester's request).
create or replace function public.confirm_reminder_request(p_request_id uuid, p_requester_jid text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.pending_reminder_requests;
  v_post_id uuid;
begin
  -- The row lock makes a second "yes" wait, then find the request already confirmed.
  select * into v_request
  from public.pending_reminder_requests
  where id = p_request_id
    and requester_jid = p_requester_jid
    and status = 'awaiting'
    and expires_at > now()
  for update;
  if not found then
    return null;
  end if;

  insert into public.scheduled_posts (group_id, kind, body, due_at, created_via, created_by_phone_e164)
  values (
    v_request.group_id, 'reminder', v_request.draft_body, v_request.draft_due_at, 'group',
    v_request.requester_phone_e164
  )
  returning id into v_post_id;

  update public.pending_reminder_requests
  set status = 'confirmed', scheduled_post_id = v_post_id
  where id = v_request.id;

  return v_post_id;
end;
$$;

revoke execute on function public.confirm_reminder_request(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_reminder_request(uuid, text) to service_role;
