-- Seed: company settings and the first owner. A template: nothing in it is specific to one
-- company (ADR-028). See README.md, "Set up for a new company".
--
-- `supabase db push` does NOT run this file. Run it once by hand in the Supabase dashboard (SQL Editor).
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
-- The company name and time zone can also be changed later on the Settings page.

insert into public.company_settings (id, company_name, timezone, bot_display_name)
values (1, '<COMPANY NAME>', '<TIME ZONE>', 'Assistant')
on conflict (id) do update
  set company_name = excluded.company_name,
      timezone = excluded.timezone;

insert into public.dashboard_users (user_id, display_name, role)
values ('<OWNER USER UID>', '<OWNER NAME>', 'owner')
on conflict (user_id) do update
  set display_name = excluded.display_name,
      role = excluded.role;
