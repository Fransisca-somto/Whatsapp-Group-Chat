-- 0006: functions, guard triggers and updated_at triggers (data-models.md §5, §6)

-- ---------------------------------------------------------------------------
-- Role helper for RLS. Renamed from current_role() because that is a reserved SQL keyword.
-- SECURITY DEFINER so policies on dashboard_users can call it without recursing into RLS.
-- ---------------------------------------------------------------------------
create or replace function public.current_dashboard_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select du.role from public.dashboard_users du where du.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Hybrid search (semantic + keyword, reciprocal rank fusion). Worker-only.
-- group_id is a required parameter: there is deliberately no cross-group search.
-- ---------------------------------------------------------------------------
create or replace function public.search_group_history(
  p_group_id uuid,
  p_query_embedding extensions.vector(1536),
  p_query_text text,
  p_limit int default 8
)
returns table (
  id uuid,
  wa_message_id text,
  sender_name text,
  body text,
  sent_at timestamptz,
  score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with semantic as (
    select gm.id, row_number() over (order by gm.embedding <=> p_query_embedding) as rank
    from public.group_messages gm
    where gm.group_id = p_group_id
      and gm.embedding is not null
      and p_query_embedding is not null
    order by gm.embedding <=> p_query_embedding
    limit 30
  ),
  keyword as (
    select gm.id,
           row_number() over (order by ts_rank_cd(gm.tsv, websearch_to_tsquery('simple', p_query_text)) desc) as rank
    from public.group_messages gm
    where gm.group_id = p_group_id
      and gm.tsv @@ websearch_to_tsquery('simple', p_query_text)
    order by ts_rank_cd(gm.tsv, websearch_to_tsquery('simple', p_query_text)) desc
    limit 30
  )
  select m.id, m.wa_message_id, m.sender_name, m.body, m.sent_at,
         (coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + k.rank), 0))::double precision as score
  from public.group_messages m
  left join semantic s on s.id = m.id
  left join keyword k on k.id = m.id
  where m.group_id = p_group_id
    and (s.id is not null or k.id is not null)
  order by score desc
  limit p_limit;
$$;

create or replace function public.search_knowledge(
  p_query_embedding extensions.vector(1536),
  p_query_text text,
  p_limit int default 5
)
returns table (
  id uuid,
  title text,
  content text,
  score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  with semantic as (
    select ke.id, row_number() over (order by ke.embedding <=> p_query_embedding) as rank
    from public.knowledge_entries ke
    where ke.is_active
      and ke.embedding is not null
      and p_query_embedding is not null
    order by ke.embedding <=> p_query_embedding
    limit 30
  ),
  keyword as (
    select ke.id,
           row_number() over (order by ts_rank_cd(ke.tsv, websearch_to_tsquery('simple', p_query_text)) desc) as rank
    from public.knowledge_entries ke
    where ke.is_active
      and ke.tsv @@ websearch_to_tsquery('simple', p_query_text)
    order by ts_rank_cd(ke.tsv, websearch_to_tsquery('simple', p_query_text)) desc
    limit 30
  )
  select e.id, e.title, e.content,
         (coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + k.rank), 0))::double precision as score
  from public.knowledge_entries e
  left join semantic s on s.id = e.id
  left join keyword k on k.id = e.id
  where e.is_active
    and (s.id is not null or k.id is not null)
  order by score desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler: atomically move due posts from 'scheduled' to 'sending'. Worker-only.
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_posts(p_claim_token uuid, p_limit int default 10)
returns setof public.scheduled_posts
language sql
as $$
  update public.scheduled_posts sp
  set status = 'sending', claim_token = p_claim_token, claimed_at = now()
  where sp.id in (
    select p.id
    from public.scheduled_posts p
    join public.groups g on g.id = p.group_id
    where p.status = 'scheduled' and p.due_at <= now() and g.status = 'active'
    order by p.due_at
    limit p_limit
    for update of p skip locked
  )
  returning sp.*;
$$;

-- ---------------------------------------------------------------------------
-- Leader lock: acquire or renew the lease. Returns false when another holder owns it. Worker-only.
-- ---------------------------------------------------------------------------
create or replace function public.acquire_worker_lock(p_instance text, p_lease_seconds int default 30)
returns boolean
language plpgsql
as $$
begin
  update public.worker_lock
  set holder = p_instance,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = 1 and (lease_expires_at < now() or holder = p_instance);
  return found;
end;
$$;

-- Worker-only functions: callable by the service role only.
revoke execute on function public.search_group_history(uuid, extensions.vector, text, int) from public, anon, authenticated;
revoke execute on function public.search_knowledge(extensions.vector, text, int) from public, anon, authenticated;
revoke execute on function public.claim_due_posts(uuid, int) from public, anon, authenticated;
revoke execute on function public.acquire_worker_lock(text, int) from public, anon, authenticated;
grant execute on function public.search_group_history(uuid, extensions.vector, text, int) to service_role;
grant execute on function public.search_knowledge(extensions.vector, text, int) to service_role;
grant execute on function public.claim_due_posts(uuid, int) to service_role;
grant execute on function public.acquire_worker_lock(text, int) to service_role;

-- The role helper is for signed-in dashboard users (RLS policies) and the service role.
revoke execute on function public.current_dashboard_role() from public, anon;
grant execute on function public.current_dashboard_role() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Guard triggers. RLS cannot stop the service-role worker, so the database enforces these rules itself.
-- ---------------------------------------------------------------------------

-- bot_actions is an append-only audit log.
create or replace function public.bot_actions_block_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'bot_actions is append-only';
end;
$$;

create trigger bot_actions_no_update_delete
  before update or delete on public.bot_actions
  for each row execute function public.bot_actions_block_change();

create trigger bot_actions_no_truncate
  before truncate on public.bot_actions
  for each statement execute function public.bot_actions_block_change();

-- group_messages: only handled_status, embedding and embedding_status may change after insert.
create or replace function public.group_messages_guard()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'handled_status' - 'embedding' - 'embedding_status' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'handled_status' - 'embedding' - 'embedding_status' - 'updated_at') then
    raise exception 'group_messages: only handled_status, embedding and embedding_status may be updated';
  end if;
  return new;
end;
$$;

create trigger group_messages_guard_update
  before update on public.group_messages
  for each row execute function public.group_messages_guard();

-- knowledge_entries: editing title or content queues the entry for re-embedding.
create or replace function public.knowledge_entries_reset_embedding()
returns trigger
language plpgsql
as $$
begin
  if new.title is distinct from old.title or new.content is distinct from old.content then
    new.embedding_status = 'pending';
  end if;
  return new;
end;
$$;

create trigger knowledge_entries_reset_embedding_update
  before update on public.knowledge_entries
  for each row execute function public.knowledge_entries_reset_embedding();

-- ---------------------------------------------------------------------------
-- updated_at on every mutable table
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'company_settings', 'dashboard_users', 'knowledge_entries', 'groups', 'authorized_users',
    'group_messages', 'scheduled_posts', 'pending_reminder_requests', 'ai_usage_daily',
    'wa_connection', 'wa_auth_state', 'pairing_requests', 'alerts'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;
