-- 0010: per-group "answer general questions too" switch, and a fix for the group_messages
-- guard trigger (ADR-030).
--
-- 1. groups.allow_general_knowledge (default on): the bot may answer general questions from the
--    model's own knowledge; company questions still come only from the group's training.
-- 2. group_messages_guard() compared whole rows, including the generated column `tsv`. In a
--    BEFORE UPDATE trigger a stored generated column is not computed yet, so NEW.tsv is null and
--    every update (even handled_status alone) was rejected. `tsv` is now left out of the
--    comparison; it is derived from `body`, which is still protected.
-- 3. One-time repair: tagged messages stuck at 'received' get the status the audit log recorded.

-- ---------------------------------------------------------------------------
-- 1. General knowledge switch
-- ---------------------------------------------------------------------------
alter table public.groups
  add column allow_general_knowledge boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2. Guard trigger fix
-- ---------------------------------------------------------------------------
create or replace function public.group_messages_guard()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'handled_status' - 'embedding' - 'embedding_status' - 'updated_at' - 'tsv')
     is distinct from
     (to_jsonb(old) - 'handled_status' - 'embedding' - 'embedding_status' - 'updated_at' - 'tsv') then
    raise exception 'group_messages: only handled_status, embedding and embedding_status may be updated';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Repair handled_status from the assistant's audit rows (latest row per message wins)
-- ---------------------------------------------------------------------------
with outcome as (
  select distinct on (ba.group_id, ba.source_wa_message_id)
         ba.group_id,
         ba.source_wa_message_id,
         case ba.action
           when 'answered' then 'answered'
           when 'refused' then 'refused'
           when 'rate_limited' then 'rate_limited'
           else 'failed'
         end as status
  from public.bot_actions ba
  where ba.actor_type = 'member'
    and ba.source_wa_message_id is not null
    and ba.action in ('answered', 'refused', 'rate_limited', 'not_set_up', 'ai_failed', 'send_failed', 'skipped_stale')
  order by ba.group_id, ba.source_wa_message_id, ba.created_at desc
)
update public.group_messages gm
set handled_status = outcome.status
from outcome
where gm.group_id = outcome.group_id
  and gm.wa_message_id = outcome.source_wa_message_id
  and gm.handled_status = 'received';
