-- 0011: search indexing and message retention (Phase 4, Workflow/Phases/06-Deep-History.md;
-- ADR-031, ADR-032).
--
-- 1. embedding_attempts on knowledge_entries and group_messages: the worker's indexing job
--    marks a row `failed` after 3 failed attempts.
-- 2. group_messages_guard() also lets embedding_attempts change; editing training resets it.
-- 3. Partial indexes on embedding_status = 'pending', so the 30 s job stays fast as history grows.
-- 4. search_group_history() leaves out the bot's own replies (P10) and also returns the sender's
--    phone number. It still requires the group: there is no cross-group search.
-- 5. purge_expired_messages() and a daily pg_cron job honour groups.retention_days (P12).

-- ---------------------------------------------------------------------------
-- 1. Attempt counters
-- ---------------------------------------------------------------------------
alter table public.knowledge_entries
  add column embedding_attempts int not null default 0;
alter table public.group_messages
  add column embedding_attempts int not null default 0;

-- ---------------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------------
create or replace function public.group_messages_guard()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'handled_status' - 'embedding' - 'embedding_status' - 'embedding_attempts' - 'updated_at' - 'tsv')
     is distinct from
     (to_jsonb(old) - 'handled_status' - 'embedding' - 'embedding_status' - 'embedding_attempts' - 'updated_at' - 'tsv') then
    raise exception 'group_messages: only handled_status, embedding, embedding_status and embedding_attempts may be updated';
  end if;
  return new;
end;
$$;

-- Editing title or content queues the entry for re-embedding with a fresh set of attempts.
create or replace function public.knowledge_entries_reset_embedding()
returns trigger
language plpgsql
as $$
begin
  if new.title is distinct from old.title or new.content is distinct from old.content then
    new.embedding_status = 'pending';
    new.embedding_attempts = 0;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Pending-row indexes for the indexing job
-- ---------------------------------------------------------------------------
create index knowledge_entries_embedding_pending_idx on public.knowledge_entries (updated_at)
  where embedding_status = 'pending';
create index group_messages_embedding_pending_idx on public.group_messages (sent_at desc)
  where embedding_status = 'pending';

-- ---------------------------------------------------------------------------
-- 4. History search without the bot's replies (return type changes, so drop and recreate)
-- ---------------------------------------------------------------------------
drop function public.search_group_history(uuid, extensions.vector, text, int);

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
  sender_phone_e164 text,
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
      and not gm.is_from_bot
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
      and not gm.is_from_bot
      and gm.tsv @@ websearch_to_tsquery('simple', p_query_text)
    order by ts_rank_cd(gm.tsv, websearch_to_tsquery('simple', p_query_text)) desc
    limit 30
  )
  select m.id, m.wa_message_id, m.sender_name, m.sender_phone_e164, m.body, m.sent_at,
         (coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + k.rank), 0))::double precision as score
  from public.group_messages m
  left join semantic s on s.id = m.id
  left join keyword k on k.id = m.id
  where m.group_id = p_group_id
    and not m.is_from_bot
    and (s.id is not null or k.id is not null)
  order by score desc
  limit p_limit;
$$;

revoke execute on function public.search_group_history(uuid, extensions.vector, text, int) from public, anon, authenticated;
grant execute on function public.search_group_history(uuid, extensions.vector, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Retention: delete messages older than each group's retention_days, daily
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_messages()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group record;
  v_batch int;
  v_deleted int;
  v_total int := 0;
begin
  for v_group in
    select g.id, g.retention_days from public.groups g where g.retention_days is not null
  loop
    v_deleted := 0;
    loop
      delete from public.group_messages
      where id in (
        select gm.id from public.group_messages gm
        where gm.group_id = v_group.id
          and gm.sent_at < now() - make_interval(days => v_group.retention_days)
        limit 5000
      );
      get diagnostics v_batch = row_count;
      v_deleted := v_deleted + v_batch;
      exit when v_batch < 5000;
    end loop;

    if v_deleted > 0 then
      insert into public.bot_actions (group_id, actor_type, actor_ref, action, detail)
      values (
        v_group.id, 'system', 'retention', 'messages_purged',
        jsonb_build_object('count', v_deleted, 'retentionDays', v_group.retention_days)
      );
    end if;
    v_total := v_total + v_deleted;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.purge_expired_messages() from public, anon, authenticated;
grant execute on function public.purge_expired_messages() to service_role;

-- 03:00 UTC (04:00 Lagos). Re-running this migration replaces the job instead of adding a second.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-expired-messages';
select cron.schedule('purge-expired-messages', '0 3 * * *', 'select public.purge_expired_messages()');
