-- 0004: worker, connection and alert tables (data-models.md §3.12 - §3.16)

create table public.wa_connection (
  id smallint primary key default 1 check (id = 1),
  status text not null default 'not_linked' check (status in ('not_linked', 'pairing', 'connecting', 'connected', 'reconnecting', 'logged_out', 'conflict')),
  linked_phone_e164 text,
  bot_jid text,
  bot_lid text,
  instance_id text,
  last_heartbeat_at timestamptz,
  last_connected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Worker-only. Values are AES-256-GCM encrypted by the worker; never readable from the dashboard.
create table public.wa_auth_state (
  key text primary key,
  value_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.worker_lock (
  id smallint primary key default 1 check (id = 1),
  holder text,
  lease_expires_at timestamptz not null default 'epoch',
  created_at timestamptz not null default now()
);

create table public.pairing_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pair', 'relink')),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'requested' check (status in ('requested', 'code_issued', 'paired', 'expired', 'failed', 'cancelled')),
  pairing_code text,
  code_expires_at timestamptz,
  error text,
  requested_by uuid not null references public.dashboard_users (user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('logged_out', 'offline', 'reconnect_failures', 'conflict')),
  incident_key text not null unique,
  sent_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The worker's two single-row tables get their id = 1 row here so it can update them immediately.
-- (company_settings is filled by supabase/seed.sql because it needs real company details.)
insert into public.wa_connection (id) values (1);
insert into public.worker_lock (id) values (1);
