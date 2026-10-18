-- 0003: messaging and scheduling tables (data-models.md §3.7 - §3.11)
-- scheduled_posts comes before pending_reminder_requests because of the foreign key.

create table public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  wa_message_id text not null,
  sender_jid text not null,
  sender_phone_e164 text,
  sender_name text,
  is_from_bot boolean not null default false,
  message_type text not null check (message_type in ('text', 'image', 'video', 'audio', 'document', 'sticker', 'other')),
  body text,
  quoted_wa_message_id text,
  mentions_bot boolean not null default false,
  sent_at timestamptz not null,
  handled_status text check (handled_status is null or handled_status in ('received', 'answered', 'refused', 'rate_limited', 'failed')),
  embedding extensions.vector(1536),
  embedding_status text not null default 'pending' check (embedding_status in ('pending', 'done', 'skipped', 'failed')),
  tsv tsvector generated always as (to_tsvector('simple', coalesce(body, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, wa_message_id)
);

create table public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  kind text not null check (kind in ('reminder', 'announcement')),
  body text not null,
  due_at timestamptz not null,
  recurrence_rule text,
  parent_post_id uuid references public.scheduled_posts (id),
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'delivery_uncertain', 'skipped_late', 'cancelled')),
  created_via text not null check (created_via in ('dashboard', 'group')),
  created_by_user_id uuid references public.dashboard_users (user_id) on delete set null,
  created_by_phone_e164 text,
  claim_token uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  sent_late boolean not null default false,
  wa_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ADR-008: recurring reminders are dashboard-only.
  check (recurrence_rule is null or created_via = 'dashboard')
);

create table public.pending_reminder_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  requester_jid text not null,
  requester_phone_e164 text,
  source_wa_message_id text not null,
  confirmation_wa_message_id text,
  draft_body text not null,
  draft_due_at timestamptz not null,
  status text not null default 'awaiting' check (status in ('awaiting', 'confirmed', 'declined', 'expired', 'superseded')),
  expires_at timestamptz not null,
  scheduled_post_id uuid references public.scheduled_posts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Audit log: append-only (enforced by a trigger in 0006). No updated_at on purpose.
create table public.bot_actions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups (id),
  actor_type text not null check (actor_type in ('member', 'authorized_user', 'dashboard_user', 'system')),
  actor_ref text,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  source_wa_message_id text,
  created_at timestamptz not null default now()
);

create table public.ai_usage_daily (
  group_id uuid not null references public.groups (id),
  usage_date date not null,
  reply_count int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  est_cost_usd numeric(10, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, usage_date)
);
