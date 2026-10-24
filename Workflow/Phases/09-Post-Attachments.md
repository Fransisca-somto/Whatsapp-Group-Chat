# Step 09 — Phase 6 (continued): Attachments and Voice Notes on Reminders and Announcements

> Requested by the owner on 2026-10-24 and kept inside Phase 6 (tasks **6.6–6.10**, branch `phase-6`). A scope addition: `project-overview.md` changes only with the owner's approval.
> Status: **approved 2026-10-24 (P27–P34 as written, with the scope change); built on `phase-6`.**

## Goal
On the dashboard, an admin can add one file they upload themselves (photo, video, audio, document) **or record a voice note** to a reminder or announcement. At the set time the bot posts it in the group with the text. Audio arrives as real WhatsApp audio and recordings as WhatsApp voice notes. **The AI never creates, edits or chooses images, audio or files**; the bot only sends what a person uploaded or recorded.

"Live audio" here means a voice note recorded in the dashboard and sent at the set time. A bot cannot stream live audio or join a call in a WhatsApp group (WhatsApp does not allow it).

## What exists already
- Dashboard posts (`scheduled_posts`, `/schedule`, `ScheduledPostDialog`), the scheduler with its at-most-once rules (ADR-011, ADR-034), the send queue.
- No file storage yet. Supabase Storage is part of the existing project (no new account).
- Baileys sends images, videos, documents (with caption), audio, and voice notes (`ptt`). WhatsApp audio and voice notes **cannot carry a caption**.

## How it works (plain language)
1. **Attach or record.** In the post form: **Attach file**, or **Record voice note** (uses the computer's or phone's microphone; listen back, re-record or remove before saving).
2. **Upload.** The file or recording goes straight from the browser to a private Supabase storage folder, after the type and size are checked. The form previews it (picture, video, a player for audio, or the file name).
3. **Send.** At the set time the worker fetches it and posts it, still at most once:
   - photo, video, document: one message, the text as caption;
   - audio file: the audio as a playable WhatsApp audio message, then the text as a second message;
   - voice note: the recording as a WhatsApp voice note (converted to WhatsApp's voice-note format first), then the text.
4. **Tidy up.** Files no longer needed are deleted automatically.

## Proposed decisions (owner to confirm)
| # | Proposal | Recommendation |
|---|---|---|
| P27 | **Allowed files:** photos (JPG, PNG, WEBP), video (MP4), audio (MP3, M4A, OGG, AAC), documents (PDF, Word, Excel, PowerPoint, TXT). **One attachment per post, up to 16 MB.** | Yes |
| P28 | **Audio and voice notes:** an uploaded audio file is sent as a real WhatsApp audio message; a recording made in the dashboard is sent as a **voice note**. Recordings up to **5 minutes**. | Yes |
| P33 | **Two messages for audio with text** (WhatsApp audio can't have a caption): the audio goes first, then the text. The post counts as sent once the audio is confirmed; if the text then fails, the post stays *sent* with a note "text not sent" (no retry, so nothing is ever duplicated). Audio alone is one message. | Yes |
| P34 | **Converting recordings:** browsers record in a format WhatsApp won't show as a voice note, so the worker converts the recording to WhatsApp's voice-note format (Ogg/Opus) when sending, using **ffmpeg** bundled as an npm package (`ffmpeg-static`, new worker dependency). | Yes (the only reliable way for voice notes to play on every phone) |
| P29 | **Only dashboard posts** take attachments. Reminders set by tagging the bot stay text-only. | Yes |
| P30 | **Cleanup:** a file is deleted when its post is cancelled before sending, or 30 days after its last send / skip / failure, once no waiting post uses it. The worker does this once a day. | Yes |
| P31 | **Longer wait for media:** up to 60 s (instead of 15 s) for WhatsApp to confirm a post with a file, so large files aren't wrongly marked "Delivery uncertain". | Yes |
| P32 | **Text is optional with an attachment** (a photo or voice note alone can be a post); without one, text is still required. | Yes |

## Tasks

### 6.6 Storage and database
- Migration `0014_post_attachments.sql`:
  - Private bucket `post-attachments`: 16 MB limit and the P27 types plus the browser recording formats (WebM/Ogg/MP4 audio), enforced by Supabase too.
  - Storage policies: signed-in dashboard users may upload, read and delete in that bucket; nobody else. The worker uses the service role.
  - `scheduled_posts`: `attachment_path`, `attachment_kind` (`image` / `video` / `audio` / `voice` / `document`), `attachment_mime`, `attachment_name`, `attachment_size`, `attachment_seconds` (voice length); a check that they are set together; body 0–2,000 characters when there is an attachment (P32).
- Shared `attachments.ts`: allowed types → kind, limits, `attachmentKindFor(mime)`; the post schema gains an optional `attachment`.

### 6.7 Dashboard: attach and record
- `AttachmentPicker`: **Attach file** (type and size checked first, upload progress, remove) and **Record voice note** (`MediaRecorder` with microphone permission, timer, stop at 5 minutes, play back, re-record, remove). Clear messages if the browser blocks the microphone.
- `ScheduledPostDialog`: the picker, and "What the group will see" shows the photo / player / file and, for audio, that the text follows as a second message.
- Server actions save the attachment details; replacing or removing deletes the old file if nothing else uses it.
- Schedule lists show a paperclip or microphone icon with the name or length.

### 6.8 Sending
- `sendQueue`: optional `media` (`image` / `video` / `document` with caption and file name, `audio`, `voice` (`ptt`)); 60 s confirmation wait for media (P31).
- `scheduler`: downloads the file (service role); converts recordings to Ogg/Opus (`media/convertVoice.ts`, ffmpeg); sends per P28/P33; marks the post as today, plus `last_error = "text not sent"` when only the audio went.
- File can't be downloaded or converted: nothing reached WhatsApp, so the post waits for the next tick and is skipped after 2 hours like any late post; conversion errors are logged.
- Repeats copy the attachment to the next date; Resend keeps it.

### 6.9 Cleanup
- Worker, once a day (leader-only), per P30: deletes unused files from storage and clears the columns; audit `attachment_deleted` (system; post id and kind, never the file).

### 6.10 Docs and scope
- Owner-approved scope change in `project-overview.md`, and the docs below.

## Files
**Shared:** `src/attachments.ts` (+ test), `src/schemas/scheduledPost.ts` (+ test), `src/database.types.ts`.
**Dashboard:** `components/schedule/AttachmentPicker.tsx` (+ test), `components/schedule/VoiceRecorder.tsx` (+ test), `components/schedule/ScheduledPostDialog.tsx` (+ test), `components/schedule/ScheduleList.tsx`, `server/actions/schedule.ts` (+ test), `lib/schedule.ts`, `lib/audit.ts`.
**Worker:** `src/whatsapp/sendQueue.ts` (+ test), `src/media/convertVoice.ts` (+ test), `src/scheduler/scheduler.ts` (+ test), `src/scheduler/attachmentCleanup.ts` (+ test), `src/db/scheduledPostsRepo.ts`, `src/db/attachmentsStore.ts`, `src/index.ts`, `package.json` (`ffmpeg-static`).
**Database:** `supabase/migrations/0014_post_attachments.sql`.

## Docs to update
- `project-overview.md` (owner-approved): attachments and voice notes on dashboard posts (§4.4–4.5); §7 keeps "media understanding" out of scope and adds "the AI never creates or edits images, audio or files".
- `progress.md`: Phase 6 tasks 6.6–6.10, session log, ADR-036 (Supabase Storage, one attachment, 16 MB, audio and voice notes as two messages, ffmpeg conversion, cleanup).
- `data-models.md`: new columns, checks, bucket and storage policies.
- `api-interfaces.md`: schedule actions, scheduler media sending, send queue, cleanup, audit.
- `architecture.md`: Supabase Storage and `ffmpeg-static` in the stack; `media/` and `scheduler/attachmentCleanup.ts`.
- `ui-context.md`: attach / record in the post dialog, list icons.

## Alternatives considered
- **Audio as a document with caption (one message):** simplest, but it arrives as a file to download rather than playable audio; the owner wants real audio.
- **Text first, then the audio:** if the audio then failed, a resend would repeat the text; audio first keeps any failure clean.
- **Convert recordings in the browser:** no reliable built-in way; would need a large in-browser encoder. Converting in the worker is dependable.
- **Upload through a server action:** Next.js limits request bodies (about 1 MB by default); direct upload to storage avoids it.
- **Several attachments per post:** more UI and messages; one covers the request.

## Risks / open questions
- **Microphone access** needs HTTPS (Vercel is) or localhost, and the browser's permission; some office PCs block microphones.
- **ffmpeg** adds about 70 MB to the worker install; the Railway / Fly.io worker supports it.
- **Storage:** the free Supabase plan has 1 GB of files; ample with the 30-day cleanup.
- **Unstable networks** affect uploads and sending, as now.

## Verify
**Automated**
- Allowed types and size; schema with and without attachment; text optional only with one.
- Picker: reject wrong or large files, upload, remove; recorder: start, stop at 5 minutes, play back, re-record, microphone blocked message.
- Send queue: the right WhatsApp message per kind; captions only where allowed; 60 s wait for media.
- Scheduler: audio then text; text failure keeps the post sent with the note; download or conversion failure → waits, never failed or duplicated; repeats copy the attachment.
- Voice conversion produces Ogg/Opus; cleanup deletes only unused, finished, older-than-30-days files.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, dashboard build.

**Live (owner, in "Softwirelex group")**
1. Announcement with a photo and caption → arrives as a photo with the text.
2. Reminder with a PDF → a document with "Reminder: …".
3. A video, and an MP3 → the video plays; the MP3 arrives as playable audio, then the text.
4. Record a short voice note in the dashboard → arrives as a WhatsApp voice note (waveform), then the text.
5. A file over 16 MB or an unsupported type → refused in the form.
6. Cancel a post with an attachment → its file is gone after the daily cleanup.

## Out of scope for this step
- The AI generating, editing or choosing images, audio or files (never).
- The bot reading or understanding media people send (unchanged).
- Live audio streams or calls in groups (not possible for WhatsApp bots).
- Attachments on reminders set by tagging the bot; several attachments per post.

## Exit criteria
- Dashboard posts with each kind (including recorded voice notes) arrive correctly, at most once.
- Wrong or too-large files are refused before upload.
- Unused files are cleaned up.
- All checks pass and the docs above are updated.
