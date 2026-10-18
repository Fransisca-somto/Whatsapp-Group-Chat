-- 0008: owner alert when the worker itself is dead (api-interfaces.md §7, ADR-025).
-- A dead worker cannot report itself, so the database checks the heartbeat every minute and
-- emails the owner through Resend. Email settings live in Supabase Vault, written by the worker
-- on startup via configure_alert_email(); nothing secret is stored in this file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Stores the Resend key, recipients and sender in Vault (create or update). Worker-only.
-- ---------------------------------------------------------------------------
create or replace function public.configure_alert_email(
  p_api_key text,
  p_recipients text[],
  p_from text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_value text;
  v_id uuid;
begin
  if coalesce(array_length(p_recipients, 1), 0) = 0 then
    raise exception 'configure_alert_email: at least one recipient is required';
  end if;

  for v_name, v_value in
    select * from (values
      ('alert_resend_api_key', p_api_key),
      ('alert_recipients', to_jsonb(p_recipients)::text),
      ('alert_from', p_from)
    ) as s(name, value)
  loop
    select id into v_id from vault.secrets where name = v_name;
    if v_id is null then
      perform vault.create_secret(v_value, v_name, 'Owner alert email setting (written by the worker)');
    else
      perform vault.update_secret(v_id, v_value);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Runs every minute. Heartbeat older than 5 minutes → one alert per incident (an incident lasts
-- until the heartbeat is fresh again). Fresh heartbeat → resolve any open offline alert.
-- ---------------------------------------------------------------------------
create or replace function public.check_worker_offline()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_heartbeat timestamptz;
  v_timezone text;
  v_key text;
  v_api_key text;
  v_recipients jsonb;
  v_from text;
  v_seen text;
begin
  select last_heartbeat_at into v_heartbeat from public.wa_connection where id = 1;
  if v_heartbeat is null then
    return; -- the worker has never run
  end if;

  if v_heartbeat > now() - interval '5 minutes' then
    update public.alerts set resolved_at = now() where kind = 'offline' and resolved_at is null;
    return;
  end if;

  if exists (select 1 from public.alerts where kind = 'offline' and resolved_at is null) then
    return; -- already alerted for this incident
  end if;

  v_key := 'offline:' || to_char(v_heartbeat at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  insert into public.alerts (kind, incident_key) values ('offline', v_key)
  on conflict (incident_key) do nothing;
  if not found then
    return;
  end if;

  select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'alert_resend_api_key';
  select decrypted_secret::jsonb into v_recipients from vault.decrypted_secrets where name = 'alert_recipients';
  select decrypted_secret into v_from from vault.decrypted_secrets where name = 'alert_from';
  if v_api_key is null or v_recipients is null or v_from is null then
    raise warning 'check_worker_offline: alert email is not configured; start the worker once';
    return;
  end if;

  select timezone into v_timezone from public.company_settings where id = 1;
  v_seen := to_char(v_heartbeat at time zone coalesce(v_timezone, 'UTC'), 'Dy DD Mon, HH12:MI AM')
    || ' (' || coalesce(v_timezone, 'UTC') || ')';

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', v_from,
      'to', v_recipients,
      'subject', '[Group Assistant] Worker offline',
      'text', 'The WhatsApp group assistant worker has not reported in since ' || v_seen || E'.\n\n'
        || E'The bot is not answering or posting until it comes back.\n\n'
        || 'What to do: check the worker on its host (Railway / Fly.io, or the computer running it) '
        || 'and restart it. You will not get another email for this outage.'
    )
  );
  -- pg_net sends asynchronously; sent_at records that the email was queued.
  update public.alerts set sent_at = now() where incident_key = v_key;
end;
$$;

revoke execute on function public.configure_alert_email(text, text[], text) from public, anon, authenticated;
revoke execute on function public.check_worker_offline() from public, anon, authenticated;
grant execute on function public.configure_alert_email(text, text[], text) to service_role;
grant execute on function public.check_worker_offline() to service_role;

-- Re-running this migration replaces the job instead of adding a second one.
select cron.unschedule(jobid) from cron.job where jobname = 'worker-offline-check';
select cron.schedule('worker-offline-check', '* * * * *', 'select public.check_worker_offline()');
