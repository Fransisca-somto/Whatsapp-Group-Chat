-- 0007: Row-Level Security (data-models.md §4) and Realtime
-- The worker uses the service role and bypasses RLS. Dashboard users are signed-in Supabase users who also
-- have a row in dashboard_users; anyone else (including a stray sign-up) matches no policy and sees nothing.

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
alter table public.company_settings enable row level security;
alter table public.dashboard_users enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.groups enable row level security;
alter table public.authorized_users enable row level security;
alter table public.authorized_user_groups enable row level security;
alter table public.group_messages enable row level security;
alter table public.pending_reminder_requests enable row level security;
alter table public.scheduled_posts enable row level security;
alter table public.bot_actions enable row level security;
alter table public.ai_usage_daily enable row level security;
alter table public.wa_connection enable row level security;
alter table public.wa_auth_state enable row level security;
alter table public.worker_lock enable row level security;
alter table public.pairing_requests enable row level security;
alter table public.alerts enable row level security;

-- Defense in depth: anonymous visitors get no table privileges at all, and signed-in users get none on worker-only tables.
revoke all on all tables in schema public from anon;
revoke all on public.wa_auth_state, public.worker_lock from authenticated;

-- ---------------------------------------------------------------------------
-- wa_auth_state, worker_lock: RLS on, no policies = no access for dashboard users.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Read-only for all dashboard users (owner + staff)
-- ---------------------------------------------------------------------------
create policy "dashboard users read" on public.wa_connection
  for select to authenticated using (public.current_dashboard_role() is not null);
create policy "dashboard users read" on public.alerts
  for select to authenticated using (public.current_dashboard_role() is not null);
create policy "dashboard users read" on public.bot_actions
  for select to authenticated using (public.current_dashboard_role() is not null);
create policy "dashboard users read" on public.ai_usage_daily
  for select to authenticated using (public.current_dashboard_role() is not null);
create policy "dashboard users read" on public.group_messages
  for select to authenticated using (public.current_dashboard_role() is not null);
create policy "dashboard users read" on public.pending_reminder_requests
  for select to authenticated using (public.current_dashboard_role() is not null);

-- ---------------------------------------------------------------------------
-- Read all; write owner only
-- ---------------------------------------------------------------------------
create policy "dashboard users read" on public.company_settings
  for select to authenticated using (public.current_dashboard_role() is not null);
create policy "owner writes" on public.company_settings
  for all to authenticated
  using (public.current_dashboard_role() = 'owner')
  with check (public.current_dashboard_role() = 'owner');

create policy "dashboard users read" on public.pairing_requests
  for select to authenticated using (public.current_dashboard_role() is not null);
create policy "owner writes" on public.pairing_requests
  for all to authenticated
  using (public.current_dashboard_role() = 'owner')
  with check (public.current_dashboard_role() = 'owner');

create policy "dashboard users read" on public.dashboard_users
  for select to authenticated using (public.current_dashboard_role() is not null);
create policy "owner writes" on public.dashboard_users
  for all to authenticated
  using (public.current_dashboard_role() = 'owner')
  with check (public.current_dashboard_role() = 'owner');

-- ---------------------------------------------------------------------------
-- Read and write for owner and staff
-- ---------------------------------------------------------------------------
create policy "dashboard users read write" on public.groups
  for all to authenticated
  using (public.current_dashboard_role() is not null)
  with check (public.current_dashboard_role() is not null);
create policy "dashboard users read write" on public.knowledge_entries
  for all to authenticated
  using (public.current_dashboard_role() is not null)
  with check (public.current_dashboard_role() is not null);
create policy "dashboard users read write" on public.authorized_users
  for all to authenticated
  using (public.current_dashboard_role() is not null)
  with check (public.current_dashboard_role() is not null);
create policy "dashboard users read write" on public.authorized_user_groups
  for all to authenticated
  using (public.current_dashboard_role() is not null)
  with check (public.current_dashboard_role() is not null);
create policy "dashboard users read write" on public.scheduled_posts
  for all to authenticated
  using (public.current_dashboard_role() is not null)
  with check (public.current_dashboard_role() is not null);

-- ---------------------------------------------------------------------------
-- Realtime: the dashboard watches worker status, pairing codes and alerts (RLS still applies).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.wa_connection, public.pairing_requests, public.alerts;
  end if;
end;
$$;
