-- 0016: multi-tenant (Phase 8, Workflow/Phases/11-Multi-Tenant.md, ADR-039).
--
-- One deployment serves many tenants (companies). Each tenant has one owner, its own WhatsApp
-- number, groups, training, AI key, staff and data.
--
--  1. tenants, platform_admins
--  2. tenant_id on every tenant-owned table; today's data becomes tenant #1
--  3. company_settings and wa_connection: one row per tenant (no more id = 1)
--  4. Per-tenant unique keys; composite foreign keys so a row can never point at another
--     tenant's group or authorized user
--  5. Triggers: fill tenant_id on insert (from the group, else the signed-in user's tenant);
--     tenant_id can never change
--  6. Functions: current_tenant_id(), is_platform_admin(), tenant_owner_email(); per-tenant
--     OpenRouter key; claim_due_posts per tenant; offline alert per tenant
--  7. RLS: every policy is limited to the caller's tenant; storage paths <tenant_id>/...
--
-- Fails on purpose (nothing is changed) if today's data has more than one owner: only one owner
-- per tenant is allowed. Change the extra owners to staff first.
--
-- Apply together with the Phase 8 worker and dashboard: older code still expects id = 1.

-- ---------------------------------------------------------------------------
-- 1. New tables
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenants_set_updated_at before update on public.tenants
  for each row execute function public.set_updated_at();

-- People who may create owners (tenants) and suspend tenants. Managed by hand / seed only.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. tenant_id columns (nullable until the backfill below)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'company_settings', 'dashboard_users', 'groups', 'knowledge_entries', 'authorized_users',
    'authorized_user_groups', 'group_messages', 'scheduled_posts', 'pending_reminder_requests',
    'bot_actions', 'ai_usage_daily', 'wa_connection', 'wa_auth_state', 'pairing_requests', 'alerts'
  ] loop
    execute format(
      'alter table public.%I add column tenant_id uuid references public.tenants (id) on delete cascade',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: today's data becomes tenant #1. A fresh database (no settings, users or groups)
-- gets no tenant; supabase/seed.sql creates the first one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant uuid;
  v_name text;
  v_owners int;
  v_secret uuid;
  v_value text;
  t text;
begin
  if not exists (select 1 from public.company_settings)
     and not exists (select 1 from public.dashboard_users)
     and not exists (select 1 from public.groups) then
    delete from public.wa_connection;  -- the empty id = 1 row from 0004
    return;
  end if;

  select count(*) into v_owners from public.dashboard_users where role = 'owner';
  if v_owners > 1 then
    raise exception 'multi-tenant migration: % dashboard users have role owner; only one owner per tenant is allowed. Change the others to staff (update public.dashboard_users set role = ''staff'' where user_id = ...) and run the migration again.', v_owners;
  end if;

  select company_name into v_name from public.company_settings limit 1;
  insert into public.tenants (name) values (coalesce(v_name, 'Company')) returning id into v_tenant;

  foreach t in array array[
    'company_settings', 'dashboard_users', 'groups', 'knowledge_entries', 'authorized_users',
    'authorized_user_groups', 'group_messages', 'scheduled_posts', 'pending_reminder_requests',
    'ai_usage_daily', 'wa_connection', 'wa_auth_state', 'pairing_requests', 'alerts'
  ] loop
    execute format('update public.%I set tenant_id = $1', t) using v_tenant;
  end loop;

  -- bot_actions is append-only (trigger); lift the guard for this one backfill.
  alter table public.bot_actions disable trigger bot_actions_no_update_delete;
  update public.bot_actions set tenant_id = v_tenant;
  alter table public.bot_actions enable trigger bot_actions_no_update_delete;

  if not exists (select 1 from public.company_settings) then
    insert into public.company_settings (company_name, timezone, tenant_id)
    values (coalesce(v_name, 'Company'), 'UTC', v_tenant);
  end if;
  if not exists (select 1 from public.wa_connection) then
    insert into public.wa_connection (tenant_id) values (v_tenant);
  end if;

  -- The current owner is the platform admin (owner decision 2026-11-14).
  insert into public.platform_admins (user_id)
  select user_id from public.dashboard_users where role = 'owner';

  -- The tenant's OpenRouter key keeps working: copy it to the per-tenant name, drop the old one.
  select id, decrypted_secret into v_secret, v_value
  from vault.decrypted_secrets where name = 'openrouter_api_key';
  if v_secret is not null then
    perform vault.create_secret(
      v_value, 'openrouter_api_key:' || v_tenant::text, 'OpenRouter API key (set by the tenant owner)'
    );
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'company_settings', 'dashboard_users', 'groups', 'knowledge_entries', 'authorized_users',
    'authorized_user_groups', 'group_messages', 'scheduled_posts', 'pending_reminder_requests',
    'bot_actions', 'ai_usage_daily', 'wa_connection', 'wa_auth_state', 'pairing_requests', 'alerts'
  ] loop
    execute format('alter table public.%I alter column tenant_id set not null', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. One settings row and one connection row per tenant
-- ---------------------------------------------------------------------------
alter table public.company_settings drop constraint company_settings_pkey;
alter table public.company_settings drop column id;
alter table public.company_settings add primary key (tenant_id);

alter table public.wa_connection drop constraint wa_connection_pkey;
alter table public.wa_connection drop column id;
alter table public.wa_connection add primary key (tenant_id);

-- ---------------------------------------------------------------------------
-- 4. Per-tenant keys and same-tenant references
-- ---------------------------------------------------------------------------
alter table public.groups drop constraint groups_wa_group_jid_key;
alter table public.groups add constraint groups_tenant_jid_key unique (tenant_id, wa_group_jid);
alter table public.groups add constraint groups_id_tenant_key unique (id, tenant_id);

alter table public.authorized_users drop constraint authorized_users_phone_e164_key;
alter table public.authorized_users add constraint authorized_users_tenant_phone_key unique (tenant_id, phone_e164);
alter table public.authorized_users add constraint authorized_users_id_tenant_key unique (id, tenant_id);

alter table public.wa_auth_state drop constraint wa_auth_state_pkey;
alter table public.wa_auth_state add primary key (tenant_id, key);

alter table public.alerts drop constraint alerts_incident_key_key;
alter table public.alerts add constraint alerts_tenant_incident_key unique (tenant_id, incident_key);

drop index public.pairing_requests_one_open_idx;
create unique index pairing_requests_one_open_idx
  on public.pairing_requests (tenant_id)
  where status in ('requested', 'code_issued');
create index pairing_requests_tenant_created_idx on public.pairing_requests (tenant_id, created_at desc);

-- Exactly one owner per tenant; one tenant per login (dashboard_users.user_id is the primary key).
create unique index dashboard_users_one_owner_idx on public.dashboard_users (tenant_id) where role = 'owner';
create index dashboard_users_tenant_idx on public.dashboard_users (tenant_id);

create index groups_tenant_idx on public.groups (tenant_id);
create index bot_actions_tenant_created_idx on public.bot_actions (tenant_id, created_at desc);
create index scheduled_posts_tenant_due_idx on public.scheduled_posts (tenant_id, status, due_at)
  where status = 'scheduled';

-- A child row's group must belong to the same tenant. Delete behaviour matches each table's
-- existing group_id foreign key (cascade only where it already cascaded).
do $$
declare
  t text;
begin
  foreach t in array array['knowledge_entries', 'authorized_user_groups'] loop
    execute format(
      'alter table public.%I add constraint %I foreign key (group_id, tenant_id) references public.groups (id, tenant_id) on delete cascade',
      t, t || '_group_tenant_fkey'
    );
  end loop;
  foreach t in array array[
    'group_messages', 'scheduled_posts', 'pending_reminder_requests', 'bot_actions', 'ai_usage_daily'
  ] loop
    execute format(
      'alter table public.%I add constraint %I foreign key (group_id, tenant_id) references public.groups (id, tenant_id)',
      t, t || '_group_tenant_fkey'
    );
  end loop;
end;
$$;

alter table public.authorized_user_groups
  add constraint authorized_user_groups_user_tenant_fkey
  foreign key (authorized_user_id, tenant_id) references public.authorized_users (id, tenant_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 5. Tenant helpers and triggers
-- ---------------------------------------------------------------------------

-- The signed-in dashboard user's tenant; null for anyone else and for suspended tenants.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select du.tenant_id
  from public.dashboard_users du
  join public.tenants t on t.id = du.tenant_id
  where du.user_id = auth.uid() and t.status = 'active';
$$;

-- Role helper: now also null when the user's tenant is suspended, so every policy shuts them out.
create or replace function public.current_dashboard_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select du.role
  from public.dashboard_users du
  join public.tenants t on t.id = du.tenant_id
  where du.user_id = auth.uid() and t.status = 'active';
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid());
$$;

revoke execute on function public.current_tenant_id() from public, anon;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.current_tenant_id() to authenticated, service_role;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- Fills tenant_id when an insert leaves it out: from the row's group if it has one, otherwise
-- the signed-in dashboard user's tenant. The worker (service role) has no signed-in user, so it
-- must give tenant_id on rows without a group. Composite foreign keys and RLS still reject any
-- tenant_id that does not match.
create or replace function public.fill_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  if new.tenant_id is null then
    v_group := (to_jsonb(new) ->> 'group_id')::uuid;
    if v_group is not null then
      select g.tenant_id into new.tenant_id from public.groups g where g.id = v_group;
    end if;
    if new.tenant_id is null then
      new.tenant_id := public.current_tenant_id();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.block_tenant_change()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception '%: tenant_id cannot change', tg_table_name;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'company_settings', 'dashboard_users', 'groups', 'knowledge_entries', 'authorized_users',
    'authorized_user_groups', 'group_messages', 'scheduled_posts', 'pending_reminder_requests',
    'bot_actions', 'ai_usage_daily', 'wa_connection', 'wa_auth_state', 'pairing_requests', 'alerts'
  ] loop
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.fill_tenant_id()',
      t || '_fill_tenant_id', t
    );
    if t <> 'bot_actions' then  -- bot_actions already rejects every update
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.block_tenant_change()',
        t || '_block_tenant_change', t
      );
    end if;
  end loop;
end;
$$;

-- The owner's login email, for alerts. Worker-only.
create or replace function public.tenant_owner_email(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text
  from public.dashboard_users du
  join auth.users u on u.id = du.user_id
  where du.tenant_id = p_tenant_id and du.role = 'owner'
  limit 1;
$$;

revoke execute on function public.tenant_owner_email(uuid) from public, anon, authenticated;
grant execute on function public.tenant_owner_email(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Per-tenant OpenRouter key (Vault secret "openrouter_api_key:<tenant id>")
-- ---------------------------------------------------------------------------
create or replace function public.set_openrouter_key(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_tenant uuid := public.current_tenant_id();
  v_name text;
  v_id uuid;
begin
  if v_tenant is null or public.current_dashboard_role() is distinct from 'owner' then
    raise exception 'only the owner can change the AI key' using errcode = '42501';
  end if;
  if char_length(v_key) < 20 or char_length(v_key) > 500 or v_key ~ '\s' then
    raise exception 'set_openrouter_key: the key format is not valid' using errcode = '22023';
  end if;

  v_name := 'openrouter_api_key:' || v_tenant::text;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(v_key, v_name, 'OpenRouter API key (set by the tenant owner)');
  else
    perform vault.update_secret(v_id, v_key);
  end if;

  update public.company_settings set openrouter_key_hint = right(v_key, 4) where tenant_id = v_tenant;
end;
$$;

create or replace function public.clear_openrouter_key()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or public.current_dashboard_role() is distinct from 'owner' then
    raise exception 'only the owner can change the AI key' using errcode = '42501';
  end if;
  delete from vault.secrets where name = 'openrouter_api_key:' || v_tenant::text;
  update public.company_settings set openrouter_key_hint = null where tenant_id = v_tenant;
end;
$$;

drop function public.get_openrouter_key();
create function public.get_openrouter_key(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'openrouter_api_key:' || p_tenant_id::text
  limit 1;
$$;

revoke execute on function public.get_openrouter_key(uuid) from public, anon, authenticated;
grant execute on function public.get_openrouter_key(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Scheduler: claim one tenant's due posts. Worker-only.
-- ---------------------------------------------------------------------------
drop function public.claim_due_posts(uuid, int);
create function public.claim_due_posts(p_tenant_id uuid, p_claim_token uuid, p_limit int default 10)
returns setof public.scheduled_posts
language sql
as $$
  update public.scheduled_posts sp
  set status = 'sending', claim_token = p_claim_token, claimed_at = now()
  where sp.id in (
    select p.id
    from public.scheduled_posts p
    join public.groups g on g.id = p.group_id
    where p.tenant_id = p_tenant_id
      and p.status = 'scheduled' and p.due_at <= now() and g.status = 'active'
    order by p.due_at
    limit p_limit
    for update of p skip locked
  )
  returning sp.*;
$$;

revoke execute on function public.claim_due_posts(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_due_posts(uuid, uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- Offline alert, per tenant. Covers active tenants whose number has been linked. Each affected
-- tenant's owner gets one email per outage. The Resend key and sender stay platform-wide in
-- Vault (written by the worker); the recipient is the tenant owner's login email.
-- ---------------------------------------------------------------------------
create or replace function public.check_worker_offline()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_key text;
  v_api_key text;
  v_from text;
  v_to text;
  v_seen text;
begin
  select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'alert_resend_api_key';
  select decrypted_secret into v_from from vault.decrypted_secrets where name = 'alert_from';

  for r in
    select c.tenant_id, c.last_heartbeat_at, s.timezone
    from public.wa_connection c
    join public.tenants t on t.id = c.tenant_id
    left join public.company_settings s on s.tenant_id = c.tenant_id
    where t.status = 'active'
      and c.last_heartbeat_at is not null
      and c.linked_phone_e164 is not null
  loop
    if r.last_heartbeat_at > now() - interval '5 minutes' then
      update public.alerts set resolved_at = now()
      where tenant_id = r.tenant_id and kind = 'offline' and resolved_at is null;
      continue;
    end if;

    if exists (
      select 1 from public.alerts
      where tenant_id = r.tenant_id and kind = 'offline' and resolved_at is null
    ) then
      continue;  -- already alerted for this outage
    end if;

    v_key := 'offline:' || to_char(r.last_heartbeat_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    insert into public.alerts (tenant_id, kind, incident_key) values (r.tenant_id, 'offline', v_key)
    on conflict (tenant_id, incident_key) do nothing;
    if not found then
      continue;
    end if;

    v_to := public.tenant_owner_email(r.tenant_id);
    if v_api_key is null or v_from is null or v_to is null then
      raise warning 'check_worker_offline: alert email is not configured for tenant %', r.tenant_id;
      continue;
    end if;

    v_seen := to_char(r.last_heartbeat_at at time zone coalesce(r.timezone, 'UTC'), 'Dy DD Mon, HH12:MI AM')
      || ' (' || coalesce(r.timezone, 'UTC') || ')';

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', v_from,
        'to', jsonb_build_array(v_to),
        'subject', '[Group Assistant] Worker offline',
        'text', 'The WhatsApp group assistant has not reported in since ' || v_seen || E'.\n\n'
          || E'The bot is not answering or posting until it comes back.\n\n'
          || 'The platform admin has been told as well. You will not get another email for this outage.'
      )
    );
    update public.alerts set sent_at = now() where tenant_id = r.tenant_id and incident_key = v_key;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS: everything limited to the caller's tenant
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.platform_admins enable row level security;
revoke all on public.tenants, public.platform_admins from anon;
revoke all on public.platform_admins from authenticated;
revoke insert, update, delete on public.tenants from authenticated;

create policy "own tenant read" on public.tenants
  for select to authenticated using (id = public.current_tenant_id());

-- Read-only for owner and staff of the tenant
drop policy "dashboard users read" on public.wa_connection;
drop policy "dashboard users read" on public.alerts;
drop policy "dashboard users read" on public.bot_actions;
drop policy "dashboard users read" on public.ai_usage_daily;
drop policy "dashboard users read" on public.group_messages;
drop policy "dashboard users read" on public.pending_reminder_requests;

create policy "tenant read" on public.wa_connection
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "tenant read" on public.alerts
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "tenant read" on public.bot_actions
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "tenant read" on public.ai_usage_daily
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "tenant read" on public.group_messages
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "tenant read" on public.pending_reminder_requests
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- Read: tenant. Write: tenant owner.
drop policy "dashboard users read" on public.company_settings;
drop policy "owner writes" on public.company_settings;
drop policy "dashboard users read" on public.pairing_requests;
drop policy "owner writes" on public.pairing_requests;

create policy "tenant read" on public.company_settings
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "tenant owner writes" on public.company_settings
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_dashboard_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_dashboard_role() = 'owner');

create policy "tenant read" on public.pairing_requests
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "tenant owner writes" on public.pairing_requests
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_dashboard_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_dashboard_role() = 'owner');

-- dashboard_users: read own tenant. No write policy: owners and staff are created and removed
-- by the dashboard's Admin and Team server actions (service role, after their own role checks).
drop policy "dashboard users read" on public.dashboard_users;
drop policy "owner writes" on public.dashboard_users;
revoke insert, update, delete on public.dashboard_users from authenticated;

create policy "tenant read" on public.dashboard_users
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- Read and write for owner and staff of the tenant
drop policy "dashboard users read write" on public.groups;
drop policy "dashboard users read write" on public.knowledge_entries;
drop policy "dashboard users read write" on public.authorized_users;
drop policy "dashboard users read write" on public.authorized_user_groups;
drop policy "dashboard users read write" on public.scheduled_posts;

create policy "tenant read write" on public.groups
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
create policy "tenant read write" on public.knowledge_entries
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
create policy "tenant read write" on public.authorized_users
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
create policy "tenant read write" on public.authorized_user_groups
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
create policy "tenant read write" on public.scheduled_posts
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Storage: new files go under "<tenant id>/". Files uploaded before this migration have no
-- tenant folder; they stay reachable through the tenant's own posts that use them.
drop policy "dashboard users read post attachments" on storage.objects;
drop policy "dashboard users upload post attachments" on storage.objects;
drop policy "dashboard users delete post attachments" on storage.objects;

create policy "tenant reads post attachments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'post-attachments'
    and public.current_tenant_id() is not null
    and (
      (storage.foldername(name))[1] = public.current_tenant_id()::text
      or exists (
        select 1 from public.scheduled_posts sp
        where sp.attachment_path = name and sp.tenant_id = public.current_tenant_id()
      )
    )
  );

create policy "tenant uploads post attachments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-attachments'
    and public.current_tenant_id() is not null
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

create policy "tenant deletes post attachments" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-attachments'
    and public.current_tenant_id() is not null
    and (
      (storage.foldername(name))[1] = public.current_tenant_id()::text
      or exists (
        select 1 from public.scheduled_posts sp
        where sp.attachment_path = name and sp.tenant_id = public.current_tenant_id()
      )
    )
  );

-- Realtime: the worker watches tenants so it can start and stop sessions.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tenants;
  end if;
end;
$$;
