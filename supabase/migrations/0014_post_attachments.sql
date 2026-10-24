-- 0014: attachments and voice notes on dashboard posts (Phase 6, tasks 6.6–6.9,
-- Workflow/Phases/09-Post-Attachments.md; ADR-036).
--
-- 1. Private storage bucket `post-attachments`: 16 MB per file, only the allowed types.
-- 2. Storage policies: dashboard users may upload, read and delete there; nobody else.
--    The worker uses the service role.
-- 3. scheduled_posts: one attachment per post (all columns set together); text may be empty
--    when there is an attachment.
-- 4. attachments_due_for_cleanup(): files no longer needed by any post (P30).

-- ---------------------------------------------------------------------------
-- 1. Bucket (re-running updates the limits instead of failing)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-attachments', 'post-attachments', false, 16777216,
  array[
    'application/msword',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/aac',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/webm',
    'audio/x-m4a',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'video/mp4'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Storage policies (signed-in dashboard users only, like every other table)
-- ---------------------------------------------------------------------------
create policy "dashboard users read post attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'post-attachments' and public.current_dashboard_role() is not null);

create policy "dashboard users upload post attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'post-attachments' and public.current_dashboard_role() is not null);

create policy "dashboard users delete post attachments" on storage.objects
  for delete to authenticated
  using (bucket_id = 'post-attachments' and public.current_dashboard_role() is not null);

-- ---------------------------------------------------------------------------
-- 3. Attachment columns
-- ---------------------------------------------------------------------------
alter table public.scheduled_posts
  add column attachment_path text,
  add column attachment_kind text
    check (attachment_kind is null or attachment_kind in ('image', 'video', 'audio', 'voice', 'document')),
  add column attachment_mime text,
  add column attachment_name text,
  add column attachment_size int
    check (attachment_size is null or attachment_size between 1 and 16777216),
  add column attachment_seconds int
    check (attachment_seconds is null or attachment_seconds between 1 and 300),
  -- Set by the cleanup job when the file itself is deleted; the details stay for history.
  add column attachment_deleted_at timestamptz;

alter table public.scheduled_posts
  add constraint scheduled_posts_attachment_complete check (
    (
      attachment_path is null and attachment_kind is null and attachment_mime is null
      and attachment_name is null and attachment_size is null and attachment_seconds is null
    )
    or (
      attachment_path is not null and attachment_kind is not null and attachment_mime is not null
      and attachment_name is not null and attachment_size is not null
      -- a voice note always has its length; nothing else does
      and (attachment_kind = 'voice') = (attachment_seconds is not null)
    )
  );

-- P32: text may be empty when there is an attachment.
alter table public.scheduled_posts drop constraint scheduled_posts_body_length;
alter table public.scheduled_posts
  add constraint scheduled_posts_body_length check (
    char_length(body) <= 2000 and (char_length(body) >= 1 or attachment_path is not null)
  );

create index scheduled_posts_attachment_idx on public.scheduled_posts (attachment_path)
  where attachment_path is not null and attachment_deleted_at is null;

-- ---------------------------------------------------------------------------
-- 4. Files no longer needed (P30): every post using the file is cancelled, or finished more
--    than 30 days ago; none is waiting or sending.
-- ---------------------------------------------------------------------------
create or replace function public.attachments_due_for_cleanup(p_limit int default 100)
returns table (attachment_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select sp.attachment_path
  from public.scheduled_posts sp
  where sp.attachment_path is not null
    and sp.attachment_deleted_at is null
  group by sp.attachment_path
  having bool_and(
    sp.status = 'cancelled'
    or (sp.status in ('sent', 'failed', 'delivery_uncertain', 'skipped_late')
        and sp.updated_at < now() - interval '30 days')
  )
  limit p_limit;
$$;

revoke execute on function public.attachments_due_for_cleanup(int) from public, anon, authenticated;
grant execute on function public.attachments_due_for_cleanup(int) to service_role;
