-- Phase 4 isolation check (Workflow/Phases/06-Deep-History.md, exit criterion "no cross-group
-- leakage"). Paste the whole file into the Supabase SQL Editor and run it.
--
-- It creates two throwaway groups with similar messages and training, searches as group A
-- (by meaning and by keyword), and fails loudly if anything from group B comes back. Everything
-- runs in one statement, so the test rows are never visible to the worker and are removed
-- before it ends. Expected result: one row, "PASS ...". Any problem shows as an error instead.

do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_query extensions.vector := array_fill(0.1::real, array[1536])::extensions.vector;
  v_count int;
  v_leaks int;
begin
  insert into public.groups (id, wa_group_jid, name, status) values
    (v_a, 'phase4-isolation-a-' || v_a || '@g.us', 'Isolation test A', 'active'),
    (v_b, 'phase4-isolation-b-' || v_b || '@g.us', 'Isolation test B', 'active');

  -- Same words and the same embedding in both groups: group B's rows are as close as A's.
  insert into public.group_messages
    (group_id, wa_message_id, sender_jid, sender_name, is_from_bot, message_type, body, sent_at, embedding, embedding_status)
  values
    (v_a, 'A1', 'a@lid', 'Ada',  false, 'text', 'Weekly reports are due on Friday', now() - interval '20 days', v_query, 'done'),
    (v_a, 'A2', 'bot@lid', null, true,  'text', 'Weekly reports are due on Friday (bot reply)', now() - interval '19 days', null, 'skipped'),
    (v_b, 'B1', 'b@lid', 'Bola', false, 'text', 'Weekly reports are due on Monday', now() - interval '20 days', v_query, 'done');

  insert into public.knowledge_entries (group_id, title, content, embedding, embedding_status) values
    (v_a, 'Reports A', 'Weekly reports go to the team lead.', v_query, 'done'),
    (v_b, 'Reports B', 'Weekly reports go to finance.', v_query, 'done');

  -- History: by meaning and keyword, then keyword only.
  select count(*), count(*) filter (where m.group_id <> v_a or m.is_from_bot)
    into v_count, v_leaks
  from public.search_group_history(v_a, v_query, 'weekly or reports', 50) r
  join public.group_messages m on m.id = r.id;
  if v_count = 0 then raise exception 'FAIL: history search found nothing for group A (test invalid)'; end if;
  if v_leaks > 0 then raise exception 'FAIL: history search returned % row(s) from group B or the bot', v_leaks; end if;

  select count(*), count(*) filter (where m.group_id <> v_a or m.is_from_bot)
    into v_count, v_leaks
  from public.search_group_history(v_a, null, 'weekly or reports', 50) r
  join public.group_messages m on m.id = r.id;
  if v_count = 0 then raise exception 'FAIL: keyword-only history search found nothing for group A'; end if;
  if v_leaks > 0 then raise exception 'FAIL: keyword-only history search returned % row(s) from group B or the bot', v_leaks; end if;

  -- Training: by meaning and keyword, then keyword only.
  select count(*), count(*) filter (where k.group_id <> v_a)
    into v_count, v_leaks
  from public.search_knowledge(v_a, v_query, 'weekly or reports', 50) r
  join public.knowledge_entries k on k.id = r.id;
  if v_count = 0 then raise exception 'FAIL: training search found nothing for group A (test invalid)'; end if;
  if v_leaks > 0 then raise exception 'FAIL: training search returned % entry(ies) from group B', v_leaks; end if;

  select count(*), count(*) filter (where k.group_id <> v_a)
    into v_count, v_leaks
  from public.search_knowledge(v_a, null, 'weekly or reports', 50) r
  join public.knowledge_entries k on k.id = r.id;
  if v_count = 0 then raise exception 'FAIL: keyword-only training search found nothing for group A'; end if;
  if v_leaks > 0 then raise exception 'FAIL: keyword-only training search returned % entry(ies) from group B', v_leaks; end if;

  -- Clean up inside the same statement.
  delete from public.knowledge_entries where group_id in (v_a, v_b);
  delete from public.group_messages where group_id in (v_a, v_b);
  delete from public.groups where id in (v_a, v_b);
end;
$$;

select 'PASS: searches as group A returned only group A rows (no group B, no bot replies); test rows removed' as result;
