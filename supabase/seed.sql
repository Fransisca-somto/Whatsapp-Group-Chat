-- Seed for a FRESH install: the first tenant, its owner, and that owner as platform admin.
-- A template: nothing in it is specific to one company. See README.md, "Set up from scratch".
-- Every later company is added from the dashboard (Admin → New owner), not with this file.
--
-- `supabase db push` does NOT run this file. Run it once by hand in the Supabase dashboard (SQL Editor).
-- Do not run it on a database that already has data: migration 0016 turned that data into tenant #1.
--
-- Before running:
--   1. In Supabase -> Authentication -> Users, create the owner's login (email + password) and
--      copy its User UID.
--   2. Replace the four placeholders below (keep the quotes):
--        <COMPANY NAME>     the company's name, e.g. 'Acme Ltd'
--        <TIME ZONE>        an IANA time zone, e.g. 'Africa/Lagos' or 'Europe/London'
--        <OWNER USER UID>   the User UID from step 1
--        <OWNER NAME>       how the owner appears in the dashboard
--   3. In Supabase -> Authentication -> Sign In / Providers, turn OFF "Allow new users to sign up".
--
-- Everything else (bot name, AI key and models, groups, training) is set from the dashboard.

do $$
declare
  v_tenant uuid;
begin
  if exists (select 1 from public.tenants) then
    raise exception 'seed.sql: a tenant already exists; add new companies from the dashboard (Admin → New owner)';
  end if;

  insert into public.tenants (name) values ('<COMPANY NAME>') returning id into v_tenant;

  insert into public.company_settings (tenant_id, company_name, timezone, bot_display_name)
  values (v_tenant, '<COMPANY NAME>', '<TIME ZONE>', 'Assistant');

  insert into public.wa_connection (tenant_id) values (v_tenant);

  insert into public.dashboard_users (user_id, tenant_id, display_name, role)
  values ('<OWNER USER UID>', v_tenant, '<OWNER NAME>', 'owner');

  insert into public.platform_admins (user_id) values ('<OWNER USER UID>');
end;
$$;
