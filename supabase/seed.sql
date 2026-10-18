-- Seed: company settings and the first owner.
--
-- `supabase db push` does NOT run this file. Run it once by hand in the Supabase dashboard (SQL Editor).
--
-- Before running:
--   1. In Supabase -> Authentication -> Users, create your login (email + password) and copy its User UID.
--   2. Replace the three placeholders below.
--   3. In Supabase -> Authentication -> Sign In / Providers, turn OFF "Allow new users to sign up".

insert into public.company_settings (id, company_name, timezone, bot_display_name)
values (1, 'SOFTWIRELEX', 'Africa/Lagos', 'Assistant') -- timezone: IANA name; Africa/Lagos is the doc example
on conflict (id) do update
  set company_name = excluded.company_name,
      timezone = excluded.timezone,
      bot_display_name = excluded.bot_display_name;

insert into public.dashboard_users (user_id, display_name, role)
values ('50d0540b-1021-4336-abe1-736fc438488f', 'Soft-Agent-Support', 'owner')
on conflict (user_id) do update
  set display_name = excluded.display_name,
      role = excluded.role;
