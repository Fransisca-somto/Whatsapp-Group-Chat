-- 0012: scheduler (Phase 5, Workflow/Phases/07-Scheduler.md; ADR-033, ADR-034).
--
-- 1. dismissed_at: an admin dismissed a failed, uncertain or skipped post from Needs attention (P18).
-- 2. One upcoming post per repeating series, so a series can never fork into two (5.4).
-- 3. Post text 1–2,000 characters (P16).
-- 4. An index for the Needs attention list.

alter table public.scheduled_posts
  add column dismissed_at timestamptz;

-- A series is identified by its first post: parent_post_id on later posts, the post's own id on
-- the first. Only one of them may be waiting to be sent at a time.
create unique index scheduled_posts_one_upcoming_per_series
  on public.scheduled_posts ((coalesce(parent_post_id, id)))
  where status = 'scheduled' and recurrence_rule is not null;

alter table public.scheduled_posts
  add constraint scheduled_posts_body_length check (char_length(body) between 1 and 2000);

create index scheduled_posts_attention_idx on public.scheduled_posts (due_at desc)
  where status in ('failed', 'delivery_uncertain', 'skipped_late') and dismissed_at is null;
