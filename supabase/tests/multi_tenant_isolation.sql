-- Phase 8 isolation check (Workflow/Phases/11-Multi-Tenant.md, ADR-039). Run AFTER migration 0016.
-- Paste the whole file into the Supabase SQL Editor and run it.
--
-- It creates two throwaway tenants (A and B) with an owner each and a staff member in A, then acts
-- as those people through RLS (the same way the dashboard does) and fails loudly if anyone can see
-- or change another tenant's data. Real tenants' data is checked too: A must see none of it.
-- Everything runs in one statement; the test rows are removed before it ends, and a failure rolls
-- everything back. Expected result: one row, "PASS ...". Any problem shows as an error instead.

do $$
declare
  v_ta uuid;
  v_tb uuid;
  v_owner_a uuid := gen_random_uuid();
  v_staff_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_group_a uuid := gen_random_uuid();
  v_group_b uuid := gen_random_uuid();
  v_jid text := 'mt-isolation-' || gen_random_uuid() || '@g.us';
  v_count int;
  v_ok boolean;
  t text;
begin
  -- ---------------------------------------------------------------- setup (as postgres)
  insert into auth.users (id, instance_id, aud, role, email)
  values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mt-owner-a-' || v_owner_a || '@example.invalid'),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mt-staff-a-' || v_staff_a || '@example.invalid'),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mt-owner-b-' || v_owner_b || '@example.invalid');

  insert into public.tenants (name) values ('Isolation test A') returning id into v_ta;
  insert into public.tenants (name) values ('Isolation test B') returning id into v_tb;
  insert into public.company_settings (tenant_id, company_name, timezone) values
    (v_ta, 'Isolation test A', 'UTC'), (v_tb, 'Isolation test B', 'UTC');
  insert into public.wa_connection (tenant_id) values (v_ta), (v_tb);
  insert into public.dashboard_users (user_id, tenant_id, display_name, role) values
    (v_owner_a, v_ta, 'Owner A', 'owner'),
    (v_staff_a, v_ta, 'Staff A', 'staff'),
    (v_owner_b, v_tb, 'Owner B', 'owner');

  -- Two tenants' bots may sit in the same WhatsApp group, and list the same phone number.
  insert into public.groups (id, tenant_id, wa_group_jid, name, status) values
    (v_group_a, v_ta, v_jid, 'Group A', 'active'),
    (v_group_b, v_tb, v_jid, 'Group B', 'active');
  insert into public.authorized_users (tenant_id, display_name, phone_e164) values
    (v_ta, 'Same person', '+2348000000001'),
    (v_tb, 'Same person', '+2348000000001');

  -- Child rows without tenant_id get it from their group (fill_tenant_id trigger).
  insert into public.knowledge_entries (group_id, title, content) values
    (v_group_a, 'Training A', 'Only for A'),
    (v_group_b, 'Training B', 'Only for B');
  insert into public.group_messages (group_id, wa_message_id, sender_jid, message_type, body, sent_at) values
    (v_group_a, 'MT-A1', 'a@lid', 'text', 'hello from A', now()),
    (v_group_b, 'MT-B1', 'b@lid', 'text', 'hello from B', now());
  insert into public.scheduled_posts (group_id, kind, body, due_at, created_via) values
    (v_group_a, 'announcement', 'Post A', now() + interval '1 day', 'dashboard'),
    (v_group_b, 'announcement', 'Post B', now() + interval '1 day', 'dashboard');
  select count(*) into v_count from public.knowledge_entries
  where (group_id = v_group_a and tenant_id <> v_ta) or (group_id = v_group_b and tenant_id <> v_tb);
  if v_count > 0 then raise exception 'FAIL: fill_tenant_id gave % child row(s) the wrong tenant', v_count; end if;

  -- A child row can never point at another tenant's group (composite foreign key).
  v_ok := false;
  begin
    insert into public.group_messages (tenant_id, group_id, wa_message_id, sender_jid, message_type, sent_at)
    values (v_ta, v_group_b, 'MT-X', 'x@lid', 'text', now());
  exception when foreign_key_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: a row of tenant A could point at tenant B''s group'; end if;

  -- tenant_id never changes.
  v_ok := false;
  begin
    update public.groups set tenant_id = v_tb where id = v_group_a;
  exception when raise_exception then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: a group''s tenant_id could be changed'; end if;

  -- ---------------------------------------------------------------- act as owner A
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  if public.current_tenant_id() is distinct from v_ta then
    raise exception 'FAIL: current_tenant_id() for owner A is %', public.current_tenant_id();
  end if;
  if public.is_platform_admin() then raise exception 'FAIL: owner A counts as a platform admin'; end if;

  foreach t in array array[
    'company_settings', 'dashboard_users', 'groups', 'knowledge_entries', 'authorized_users',
    'group_messages', 'scheduled_posts', 'bot_actions', 'ai_usage_daily', 'wa_connection',
    'pairing_requests', 'alerts', 'pending_reminder_requests', 'authorized_user_groups'
  ] loop
    execute format('select count(*) from public.%I where tenant_id <> $1', t) into v_count using v_ta;
    if v_count > 0 then
      raise exception 'FAIL: owner A can see % row(s) of other tenants in %', v_count, t;
    end if;
  end loop;
  select count(*) into v_count from public.tenants where id <> v_ta;
  if v_count > 0 then raise exception 'FAIL: owner A can see % other tenant(s)', v_count; end if;
  select count(*) into v_count from public.groups where id = v_group_a;
  if v_count <> 1 then raise exception 'FAIL: owner A cannot see their own group (test invalid)'; end if;

  -- Writing into tenant B is refused; changing B's rows changes nothing.
  v_ok := false;
  begin
    insert into public.groups (tenant_id, wa_group_jid, name) values (v_tb, 'mt-x@g.us', 'Sneaky');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: owner A could create a group in tenant B'; end if;

  update public.groups set name = 'Changed by A' where id = v_group_b;
  get diagnostics v_count = row_count;
  if v_count > 0 then raise exception 'FAIL: owner A could rename tenant B''s group'; end if;
  delete from public.knowledge_entries where group_id = v_group_b;
  get diagnostics v_count = row_count;
  if v_count > 0 then raise exception 'FAIL: owner A could delete tenant B''s training'; end if;

  -- An insert without tenant_id lands in A's own tenant.
  insert into public.authorized_users (display_name, phone_e164) values ('Filled', '+2348000000002');
  select count(*) into v_count from public.authorized_users where phone_e164 = '+2348000000002' and tenant_id = v_ta;
  if v_count <> 1 then raise exception 'FAIL: an insert without tenant_id did not land in tenant A'; end if;

  -- Logins are managed by the Admin / Team actions (service role), never directly.
  v_ok := false;
  begin
    insert into public.dashboard_users (user_id, tenant_id, display_name, role) values (v_owner_b, v_ta, 'x', 'staff');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: a signed-in user could write dashboard_users'; end if;

  -- Storage: uploads only into the tenant's own folder.
  v_ok := false;
  begin
    insert into storage.objects (bucket_id, name) values ('post-attachments', v_tb || '/mt/test.txt');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: owner A could upload into tenant B''s folder'; end if;

  reset role;

  -- ---------------------------------------------------------------- act as staff A
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.company_settings set company_name = 'Changed by staff' where tenant_id = v_ta;
  get diagnostics v_count = row_count;
  if v_count > 0 then raise exception 'FAIL: staff could change company settings'; end if;
  v_ok := false;
  begin
    perform public.set_openrouter_key('sk-or-v1-0000000000000000000000000000');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: staff could set the AI key'; end if;
  select count(*) into v_count from public.groups where id = v_group_a;
  if v_count <> 1 then raise exception 'FAIL: staff A cannot see their tenant''s group'; end if;

  reset role;

  -- ---------------------------------------------------------------- suspended tenant
  update public.tenants set status = 'suspended' where id = v_ta;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.groups;
  if v_count > 0 or public.current_dashboard_role() is not null then
    raise exception 'FAIL: a suspended tenant''s owner can still see data';
  end if;
  reset role;

  -- ---------------------------------------------------------------- clean up (as postgres)
  perform set_config('request.jwt.claims', '', true);
  delete from public.scheduled_posts where tenant_id in (v_ta, v_tb);
  delete from public.group_messages where tenant_id in (v_ta, v_tb);
  delete from public.tenants where id in (v_ta, v_tb);  -- cascades to the rest
  delete from auth.users where id in (v_owner_a, v_staff_a, v_owner_b);
end;
$$;

select 'PASS: each tenant sees and changes only its own data; staff and suspended tenants are limited; test rows removed' as result;
