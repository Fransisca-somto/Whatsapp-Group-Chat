-- 0005: indexes (data-models.md §3 "Indexes" notes)

-- Knowledge search
create index knowledge_entries_embedding_idx on public.knowledge_entries
  using hnsw (embedding extensions.vector_cosine_ops);
create index knowledge_entries_tsv_idx on public.knowledge_entries using gin (tsv);

-- Group history: recent messages, semantic search, keyword search
create index group_messages_group_sent_idx on public.group_messages (group_id, sent_at desc);
create index group_messages_embedding_idx on public.group_messages
  using hnsw (embedding extensions.vector_cosine_ops);
create index group_messages_tsv_idx on public.group_messages using gin (tsv);

-- Scheduler poller: only rows waiting to be sent
create index scheduled_posts_due_idx on public.scheduled_posts (status, due_at)
  where status = 'scheduled';

-- One awaiting confirmation per user per group
create unique index pending_reminder_one_awaiting_idx
  on public.pending_reminder_requests (group_id, requester_jid)
  where status = 'awaiting';

-- At most one open pairing request at a time
create unique index pairing_requests_one_open_idx
  on public.pairing_requests ((true))
  where status in ('requested', 'code_issued');
