-- 0002: core tables (data-models.md §3.1 - §3.6)

create table public.company_settings (
  id smallint primary key default 1 check (id = 1),
  company_name text not null,
  timezone text not null,
  owner_alert_phone text check (owner_alert_phone is null or owner_alert_phone ~ '^\+[1-9][0-9]{7,14}$'),
  bot_display_name text not null default 'Assistant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dashboard_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  is_active boolean not null default true,
  embedding extensions.vector(1536),
  embedding_status text not null default 'pending' check (embedding_status in ('pending', 'done', 'failed')),
  tsv tsvector generated always as (to_tsvector('simple', title || ' ' || content)) stored,
  updated_by uuid references public.dashboard_users (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  wa_group_jid text not null unique,
  name text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'removed', 'archived')),
  reminder_permission text not null default 'admins_only' check (reminder_permission in ('admins_only', 'any_member')),
  ai_enabled boolean not null default true,
  daily_reply_cap int not null default 200 check (daily_reply_cap > 0),
  retention_days int check (retention_days is null or retention_days > 0),
  approved_by uuid references public.dashboard_users (user_id) on delete set null,
  approved_at timestamptz,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.authorized_users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  all_groups boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.authorized_user_groups (
  authorized_user_id uuid not null references public.authorized_users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (authorized_user_id, group_id)
);
