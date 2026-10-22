-- 0009: Phase 3 — AI provider set from the dashboard, per-group training, usage counter
-- (Workflow/Phases/05-Tagged-QA.md, ADR-026, ADR-027).
--
-- 1. Training belongs to one group (supersedes the shared knowledge base of ADR-005).
-- 2. The company's OpenRouter key lives in Supabase Vault; only the owner can set or clear it
--    (checked inside the database), only the worker can read it. Models and a 4-character hint
--    live in company_settings, which dashboard users can read.
-- 3. Optional per-group bot instructions.
-- 4. record_ai_usage(): atomic add to ai_usage_daily (worker-only).

-- ---------------------------------------------------------------------------
-- 1. Per-group training. The table was empty when this migration was written; the not-null
--    column fails loudly instead of guessing a group if rows exist.
-- ---------------------------------------------------------------------------
alter table public.knowledge_entries
  add column group_id uuid not null references public.groups (id) on delete cascade;

alter table public.knowledge_entries
  add constraint knowledge_entries_title_length check (char_length(title) between 1 and 200),
  add constraint knowledge_entries_content_length check (char_length(content) between 1 and 8000);

create index knowledge_entries_group_idx on public.knowledge_entries (group_id, updated_at desc);

-- search_knowledge now requires the group, like search_group_history: no cross-group search.
drop function public.search_knowledge(extensions.vector, text, int);

create or replace function public.search_knowledge(
  p_group_id uuid,
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
    where ke.group_id = p_group_id
      and ke.is_active
      and ke.embedding is not null
      and p_query_embedding is not null
    order by ke.embedding <=> p_query_embedding
    limit 30
  ),
  keyword as (
    select ke.id,
           row_number() over (order by ts_rank_cd(ke.tsv, websearch_to_tsquery('simple', p_query_text)) desc) as rank
    from public.knowledge_entries ke
    where ke.group_id = p_group_id
      and ke.is_active
      and ke.tsv @@ websearch_to_tsquery('simple', p_query_text)
    order by ts_rank_cd(ke.tsv, websearch_to_tsquery('simple', p_query_text)) desc
    limit 30
  )
  select e.id, e.title, e.content,
         (coalesce(1.0 / (60 + s.rank), 0) + coalesce(1.0 / (60 + k.rank), 0))::double precision as score
  from public.knowledge_entries e
  left join semantic s on s.id = e.id
  left join keyword k on k.id = e.id
  where e.group_id = p_group_id
    and e.is_active
    and (s.id is not null or k.id is not null)
  order by score desc
  limit p_limit;
$$;

revoke execute on function public.search_knowledge(uuid, extensions.vector, text, int) from public, anon, authenticated;
grant execute on function public.search_knowledge(uuid, extensions.vector, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 2. AI provider settings
-- ---------------------------------------------------------------------------
alter table public.company_settings
  add column ai_chat_model text check (ai_chat_model is null or char_length(ai_chat_model) between 1 and 200),
  add column ai_fallback_model text check (ai_fallback_model is null or char_length(ai_fallback_model) between 1 and 200),
  add column openrouter_key_hint text check (openrouter_key_hint is null or char_length(openrouter_key_hint) <= 8);

-- Owner only (checked here, not just in the dashboard). Stores the key in Vault and the last
-- four characters as a hint the dashboard can show. The key is never returned.
create or replace function public.set_openrouter_key(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_id uuid;
begin
  if public.current_dashboard_role() is distinct from 'owner' then
    raise exception 'only the owner can change the AI key' using errcode = '42501';
  end if;
  if char_length(v_key) < 20 or char_length(v_key) > 500 or v_key ~ '\s' then
    raise exception 'set_openrouter_key: the key format is not valid' using errcode = '22023';
  end if;

  select id into v_id from vault.secrets where name = 'openrouter_api_key';
  if v_id is null then
    perform vault.create_secret(v_key, 'openrouter_api_key', 'OpenRouter API key (set by the dashboard owner)');
  else
    perform vault.update_secret(v_id, v_key);
  end if;

  update public.company_settings set openrouter_key_hint = right(v_key, 4) where id = 1;
end;
$$;

create or replace function public.clear_openrouter_key()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_dashboard_role() is distinct from 'owner' then
    raise exception 'only the owner can change the AI key' using errcode = '42501';
  end if;
  delete from vault.secrets where name = 'openrouter_api_key';
  update public.company_settings set openrouter_key_hint = null where id = 1;
end;
$$;

-- Worker-only read of the key (null when none is set).
create or replace function public.get_openrouter_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'openrouter_api_key' limit 1;
$$;

revoke execute on function public.set_openrouter_key(text) from public, anon;
revoke execute on function public.clear_openrouter_key() from public, anon;
grant execute on function public.set_openrouter_key(text) to authenticated;
grant execute on function public.clear_openrouter_key() to authenticated;
revoke execute on function public.get_openrouter_key() from public, anon, authenticated;
grant execute on function public.get_openrouter_key() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Per-group bot instructions (added to the fixed rules, never replacing them)
-- ---------------------------------------------------------------------------
alter table public.groups
  add column bot_instructions text check (bot_instructions is null or char_length(bot_instructions) <= 1000);

-- ---------------------------------------------------------------------------
-- 4. AI usage counter. Adds to the day's row in one statement so concurrent replies never
--    lose a count. usage_date is the company-timezone date, computed by the caller.
-- ---------------------------------------------------------------------------
create or replace function public.record_ai_usage(
  p_group_id uuid,
  p_usage_date date,
  p_input_tokens int,
  p_output_tokens int,
  p_cost_usd numeric,
  p_replies int default 1
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage_daily (group_id, usage_date, reply_count, input_tokens, output_tokens, est_cost_usd)
  values (p_group_id, p_usage_date, greatest(p_replies, 0), greatest(p_input_tokens, 0),
          greatest(p_output_tokens, 0), greatest(p_cost_usd, 0))
  on conflict (group_id, usage_date) do update
    set reply_count = public.ai_usage_daily.reply_count + excluded.reply_count,
        input_tokens = public.ai_usage_daily.input_tokens + excluded.input_tokens,
        output_tokens = public.ai_usage_daily.output_tokens + excluded.output_tokens,
        est_cost_usd = public.ai_usage_daily.est_cost_usd + excluded.est_cost_usd;
$$;

revoke execute on function public.record_ai_usage(uuid, date, int, int, numeric, int) from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, date, int, int, numeric, int) to service_role;
