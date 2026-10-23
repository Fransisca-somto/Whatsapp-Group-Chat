# Data Models — Supabase Postgres

> Source of truth for the schema. Every migration must update this file in the same task.
> All timestamps are `timestamptz` (UTC). All IDs are `uuid default gen_random_uuid()` unless noted. Every table has `created_at timestamptz not null default now()`; mutable tables also have `updated_at` maintained by a trigger.

---

## 1. Entity Overview

```
company_settings (1 row)
dashboard_users ── auth.users

groups ─┬── knowledge_entries          (per group training, ADR-026)
        ├── group_messages             (per group history, searchable)
        ├── scheduled_posts            (reminders + announcements)
        ├── pending_reminder_requests  (awaiting "yes")
        ├── authorized_user_groups ── authorized_users
        ├── bot_actions                (audit)
        └── ai_usage_daily

wa_connection (1 row) · wa_auth_state (key/value) · worker_lock (1 row)
pairing_requests · alerts
```

## 2. Extensions

```sql
create extension if not exists vector;
create extension if not exists pgcrypto;
```

## 3. Tables

### 3.1 `company_settings` (single row, `id = 1`)
| Column | Type | Notes |
|---|---|---|
| id | smallint PK | check `id = 1` |
| company_name | text not null | Used in the AI system prompt |
| timezone | text not null | IANA name, e.g. `Africa/Lagos` |
| owner_alert_phone | text | E.164. Unused since ADR-025; not shown in Settings |
| bot_display_name | text not null default 'Assistant' | |
| ai_chat_model | text | OpenRouter model id, e.g. `anthropic/claude-haiku-5.5`; null = AI not configured (0009) |
| ai_fallback_model | text | null = no fallback (0009) |
| openrouter_key_hint | text | Last 4 characters of the saved key, ≤ 8 chars; written only by `set_openrouter_key()` (0009) |

The OpenRouter key itself is **not** in any table: it is the Vault secret `openrouter_api_key` (§5.6, ADR-027).

### 3.2 `dashboard_users`
| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK | FK → `auth.users.id` on delete cascade |
| display_name | text not null | |
| role | text not null | check in (`owner`,`staff`) |

### 3.3 `knowledge_entries` (per-group training)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid not null | FK → groups on delete cascade. The bot in a group reads only that group's entries (0009, ADR-026) |
| title | text not null | The heading, 1–200 chars |
| content | text not null | 1–8,000 chars. Markdown; `## Subheading` lines separate sections |
| is_active | boolean not null default true | Inactive entries are never retrieved |
| embedding | vector(1536) | null until embedded |
| embedding_status | text not null default 'pending' | `pending`,`done`,`failed` |
| tsv | tsvector generated always as (to_tsvector('simple', title \|\| ' ' \|\| content)) stored | |
| updated_by | uuid | FK → dashboard_users |

Indexes: HNSW on `embedding vector_cosine_ops`; GIN on `tsv`; (`group_id`, `updated_at desc`).
Editing `title` or `content` resets `embedding_status = 'pending'`.

### 3.4 `groups`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| wa_group_jid | text unique not null | e.g. `1203...@g.us` |
| name | text not null | Synced from WhatsApp |
| status | text not null default 'pending' | `pending`,`active`,`paused`,`removed`,`archived` |
| reminder_permission | text not null default 'admins_only' | `admins_only`,`any_member` |
| ai_enabled | boolean not null default true | |
| daily_reply_cap | int not null default 200 | |
| retention_days | int | null = keep forever `[DEFAULT]` |
| approved_by | uuid | FK → dashboard_users |
| approved_at | timestamptz | |
| last_activity_at | timestamptz | |
| bot_instructions | text | Optional, ≤ 1,000 chars. Added to the fixed answer rules for this group, never replacing them (0009, ADR-026) |
| allow_general_knowledge | boolean not null default true | General questions may be answered from the model's own knowledge; company questions stay training-only (0010, ADR-030) |

`active` and `paused` groups have messages stored (owner decision, 2026-10-19); only `active` groups get replies and posts. `pending`, `removed` and `archived` groups store nothing. The worker sets `pending` (new or re-added group) and `removed` (bot left); the dashboard moves groups only along the transitions in `packages/shared/src/groups.ts` (approve, pause, resume, archive).

### 3.5 `authorized_users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| display_name | text not null | |
| phone_e164 | text unique not null | check `^\+[1-9][0-9]{7,14}$` |
| all_groups | boolean not null default true | If false, see `authorized_user_groups` |
| is_active | boolean not null default true | |

### 3.6 `authorized_user_groups`
| Column | Type | Notes |
|---|---|---|
| authorized_user_id | uuid | FK → authorized_users on delete cascade |
| group_id | uuid | FK → groups on delete cascade |
| | | PK (`authorized_user_id`, `group_id`) |

### 3.7 `group_messages`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid not null | FK → groups |
| wa_message_id | text not null | unique (`group_id`, `wa_message_id`) — **the dedupe key** |
| sender_jid | text not null | May be a phone JID or a LID |
| sender_phone_e164 | text | null if not resolvable |
| sender_name | text | WhatsApp push name |
| is_from_bot | boolean not null default false | |
| message_type | text not null | `text`,`image`,`video`,`audio`,`document`,`sticker`,`other` |
| body | text | Text or caption; null for media without caption |
| quoted_wa_message_id | text | If it replies to another message |
| mentions_bot | boolean not null default false | |
| sent_at | timestamptz not null | WhatsApp timestamp |
| handled_status | text | null for untagged; else `received`,`answered`,`refused`,`rate_limited`,`failed` |
| embedding | vector(1536) | null until embedded; only for text ≥ 3 words |
| embedding_status | text not null default 'pending' | `pending`,`done`,`skipped`,`failed` |
| tsv | tsvector generated always as (to_tsvector('simple', coalesce(body,''))) stored | |

Indexes: (`group_id`, `sent_at desc`); HNSW on `embedding`; GIN on `tsv`.

### 3.8 `pending_reminder_requests`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid not null | FK → groups |
| requester_jid | text not null | |
| requester_phone_e164 | text | |
| source_wa_message_id | text not null | The tagging message |
| confirmation_wa_message_id | text | The bot's "reply yes to confirm" message |
| draft_body | text not null | |
| draft_due_at | timestamptz not null | |
| status | text not null default 'awaiting' | `awaiting`,`confirmed`,`declined`,`expired`,`superseded` |
| expires_at | timestamptz not null | created_at + 2 minutes |
| scheduled_post_id | uuid | FK → scheduled_posts, set on confirm |

Partial unique index: one `awaiting` row per (`group_id`, `requester_jid`). A new request marks the old one `superseded`.

### 3.9 `scheduled_posts` (reminders and announcements)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid not null | FK → groups |
| kind | text not null | `reminder`,`announcement` |
| body | text not null | |
| due_at | timestamptz not null | |
| recurrence_rule | text | RFC 5545 RRULE; null = one-off. Dashboard-only. |
| parent_post_id | uuid | FK → scheduled_posts; set on generated recurrences |
| status | text not null default 'scheduled' | see state machine below |
| created_via | text not null | `dashboard`,`group` |
| created_by_user_id | uuid | FK → dashboard_users (dashboard) |
| created_by_phone_e164 | text | (group) |
| claim_token | uuid | Set when claimed |
| claimed_at | timestamptz | |
| sent_at | timestamptz | |
| sent_late | boolean not null default false | |
| wa_message_id | text | Set after successful send |
| last_error | text | |

Index: (`status`, `due_at`) where status = 'scheduled'.

**Status state machine**
```
scheduled ──claim──► sending ──ok──► sent
    │                   │
    │                   ├──send error──► failed
    │                   └──crash (found on boot)──► delivery_uncertain
    ├──due_at older than 2h when found──► skipped_late
    └──dashboard──► cancelled
delivery_uncertain / failed ──dashboard Resend──► scheduled
```
Groups that become `removed` or `paused`: their `scheduled` posts are left as-is and not claimed until the group is `active` again.

### 3.10 `bot_actions` (audit log, append-only)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| group_id | uuid | nullable for system events |
| actor_type | text not null | `member`,`authorized_user`,`dashboard_user`,`system` |
| actor_ref | text | phone, jid or user_id |
| action | text not null | e.g. `answered`, `refused_unauthorized`, `reminder_requested`, `reminder_confirmed`, `reminder_expired`, `post_sent`, `post_skipped`, `relink_requested`, `group_approved` |
| detail | jsonb not null default '{}' | No secrets |
| source_wa_message_id | text | |

### 3.11 `ai_usage_daily`
| Column | Type | Notes |
|---|---|---|
| group_id | uuid | FK → groups |
| usage_date | date | In company timezone |
| reply_count | int not null default 0 | |
| input_tokens | int not null default 0 | |
| output_tokens | int not null default 0 | |
| est_cost_usd | numeric(10,4) not null default 0 | |
| | | PK (`group_id`, `usage_date`) |

### 3.12 `wa_connection` (single row, `id = 1`)
| Column | Type | Notes |
|---|---|---|
| id | smallint PK | check `id = 1` |
| status | text not null default 'not_linked' | `not_linked`,`pairing`,`connecting`,`connected`,`reconnecting`,`logged_out`,`conflict` |
| linked_phone_e164 | text | |
| bot_jid | text | |
| bot_lid | text | |
| instance_id | text | Worker holding the lock |
| last_heartbeat_at | timestamptz | Updated every 15 s |
| last_connected_at | timestamptz | |
| last_error | text | |

Dashboard computes **offline** as `now() - last_heartbeat_at > 60s`.

### 3.13 `wa_auth_state` (worker-only)
| Column | Type | Notes |
|---|---|---|
| key | text PK | e.g. `creds`, `pre-key-12`, `session-...` |
| value_enc | text not null | base64(iv ‖ ciphertext ‖ tag), AES-256-GCM |
| updated_at | timestamptz | |

### 3.14 `worker_lock` (single row, `id = 1`)
| Column | Type | Notes |
|---|---|---|
| id | smallint PK | check `id = 1` |
| holder | text | instance_id |
| lease_expires_at | timestamptz not null default 'epoch' | |

### 3.15 `pairing_requests`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| kind | text not null | `pair`,`relink` |
| phone_e164 | text not null | Number to link |
| status | text not null default 'requested' | `requested`,`code_issued`,`paired`,`expired`,`failed`,`cancelled` |
| pairing_code | text | Shown in dashboard |
| code_expires_at | timestamptz | |
| error | text | |
| requested_by | uuid not null | FK → dashboard_users (must be owner) |

Partial unique index: at most one row with status in (`requested`,`code_issued`).

### 3.16 `alerts`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| kind | text not null | `logged_out`,`offline`,`reconnect_failures`,`conflict` |
| incident_key | text unique not null | Prevents duplicate alerts per incident |
| sent_at | timestamptz | |
| resolved_at | timestamptz | |

## 4. Row-Level Security

RLS is **enabled on every table**. The worker uses the service role and bypasses RLS.

| Table | Authenticated dashboard users |
|---|---|
| `wa_auth_state`, `worker_lock` | **No access** |
| `company_settings`, `pairing_requests` | Read: all. Write: `owner` only. |
| `wa_connection`, `alerts`, `bot_actions`, `ai_usage_daily`, `group_messages` | Read only. |
| `groups`, `knowledge_entries`, `authorized_users`, `authorized_user_groups`, `scheduled_posts` | Read and write (`owner`, `staff`). |
| `pending_reminder_requests` | Read only. |
| `dashboard_users` | Read: all. Write: `owner` only. |

Helper: `public.current_dashboard_role()` returns the caller's role from `dashboard_users` (`security definer`; null if the caller is not a dashboard user). It was renamed from `current_role()` because that is a reserved SQL keyword. Every policy requires a non-null role, so a stray Supabase sign-up sees nothing. Public sign-ups should also be disabled in Supabase Auth.

Defense in depth: `anon` has no table privileges, and `authenticated` has none on `wa_auth_state` and `worker_lock`. Worker-only functions (§5) are executable by `service_role` only. The exceptions are `set_openrouter_key()` and `clear_openrouter_key()` (§5.6): `authenticated` may call them, and they check for the owner role themselves. The Vault secret is never readable through RLS.

## 5. Database Functions

### 5.1 `search_group_history(p_group_id uuid, p_query_embedding vector(1536), p_query_text text, p_limit int default 8)`
Hybrid search scoped to **one group**. Returns `id, wa_message_id, sender_name, body, sent_at, score`.
```sql
with semantic as (
  select id, row_number() over (order by embedding <=> p_query_embedding) as rank
  from group_messages
  where group_id = p_group_id and embedding is not null
  order by embedding <=> p_query_embedding
  limit 30
),
keyword as (
  select id, row_number() over (order by ts_rank_cd(tsv, websearch_to_tsquery('simple', p_query_text)) desc) as rank
  from group_messages
  where group_id = p_group_id and tsv @@ websearch_to_tsquery('simple', p_query_text)
  limit 30
)
select m.id, m.wa_message_id, m.sender_name, m.body, m.sent_at,
       coalesce(1.0/(60+s.rank),0) + coalesce(1.0/(60+k.rank),0) as score
from group_messages m
left join semantic s on s.id = m.id
left join keyword k on k.id = m.id
where s.id is not null or k.id is not null
order by score desc
limit p_limit;
```
### 5.2 `search_knowledge(p_group_id uuid, p_query_embedding, p_query_text, p_limit int default 5)`
Same reciprocal rank fusion over the **given group's** active `knowledge_entries`. The group is required (migration 0009 replaced the earlier group-less version), so training never crosses groups.

### 5.3 `claim_due_posts(p_claim_token uuid, p_limit int default 10)`
Atomically moves due rows from `scheduled` to `sending`:
```sql
update scheduled_posts sp set status = 'sending', claim_token = p_claim_token, claimed_at = now()
where sp.id in (
  select p.id from scheduled_posts p join groups g on g.id = p.group_id
  where p.status = 'scheduled' and p.due_at <= now() and g.status = 'active'
  order by p.due_at
  limit p_limit
  for update of p skip locked
)
returning sp.*;
```
### 5.4 `acquire_worker_lock(p_instance text, p_lease_seconds int default 30) returns boolean`
```sql
update worker_lock set holder = p_instance, lease_expires_at = now() + make_interval(secs => p_lease_seconds)
where id = 1 and (lease_expires_at < now() or holder = p_instance)
returning true;
```
Returns false when no row was updated. (Implemented in plpgsql with `return found`; the SQL above shows the logic.)

### 5.5 Owner alert functions (migration `0008_offline_alert.sql`)
- Extensions `pg_cron` and `pg_net` are enabled; Supabase Vault (preinstalled) holds the email settings.
- `configure_alert_email(p_api_key text, p_recipients text[], p_from text) returns void`: creates or updates the Vault secrets `alert_resend_api_key`, `alert_recipients` (JSON array) and `alert_from`. `security definer`, `service_role` only. Called by the worker on every leader start.
- `check_worker_offline() returns void`: if `wa_connection.last_heartbeat_at` is older than 5 minutes and no `offline` alert is open, inserts `alerts(kind 'offline', incident_key 'offline:<heartbeat UTC>')`, queues an email to Resend through `net.http_post` and sets `sent_at`; if the heartbeat is fresh, resolves open `offline` alerts. Does nothing if the worker has never sent a heartbeat. `security definer`, `service_role` only.
- `pg_cron` job `worker-offline-check` runs `check_worker_offline()` every minute. The migration unschedules any job with that name first, so re-running it never duplicates the job.

### 5.6 AI provider and usage functions (migration `0009_ai_settings_and_group_training.sql`)
- `set_openrouter_key(p_key text) returns void`: creates or updates the Vault secret `openrouter_api_key` and sets `company_settings.openrouter_key_hint` to the last 4 characters. `security definer`; raises `42501` unless `current_dashboard_role() = 'owner'`, and rejects keys shorter than 20, longer than 500 or containing whitespace. Executable by `authenticated` (the dashboard calls it with the owner's session; the key is checked with OpenRouter first, in the server action).
- `clear_openrouter_key() returns void`: deletes the Vault secret and clears the hint. Owner only, same check.
- `get_openrouter_key() returns text`: the decrypted key, or null. `service_role` only (worker).
- `record_ai_usage(p_group_id uuid, p_usage_date date, p_input_tokens int, p_output_tokens int, p_cost_usd numeric, p_replies int default 1) returns void`: one-statement upsert that adds to the day's `ai_usage_daily` row, so concurrent replies never lose a count. `p_usage_date` is the company-timezone date, computed by the caller. `service_role` only.

**Implementation notes (migration `0006_functions.sql`)**
- Both search functions order each branch by rank *before* `limit 30`, skip the semantic branch when the query embedding is null, and re-check `group_id` in the final select.
- Search functions, `claim_due_posts` and `acquire_worker_lock` are executable by `service_role` only.
- `claim_due_posts` is declared `returns setof scheduled_posts`.

## 6. Data Rules

- Phone numbers always stored in E.164.
- `group_messages` is never updated except `handled_status`, `embedding`, `embedding_status` (and the automatic `updated_at`). Enforced by the `group_messages_guard` trigger, which also binds the service-role worker. The trigger compares the row without the generated `tsv` column: in a BEFORE UPDATE trigger a stored generated column is not computed yet (NEW.tsv is null), which made every update fail until migration 0010 (found 2026-10-23; 0010 also repaired tagged messages left at `received`, using the audit log).
- `bot_actions` is append-only (no update/delete policy, even for owner). Enforced by triggers that reject UPDATE, DELETE and TRUNCATE.
- `knowledge_entries`: editing `title` or `content` resets `embedding_status` to `pending` (trigger). Every dashboard write filters on both `id` and `group_id`; the worker reads only the asking group's rows.
- `scheduled_posts`: a check constraint allows `recurrence_rule` only when `created_via = 'dashboard'` (ADR-008).
- `updated_at` is maintained by a `set_updated_at()` trigger on every mutable table; `group_messages` therefore also carries `updated_at`.
- Retention job (daily, worker): delete `group_messages` older than `groups.retention_days` when set.
- Search functions **must** take `group_id` as a required parameter. There is no cross-group search function, by design.
