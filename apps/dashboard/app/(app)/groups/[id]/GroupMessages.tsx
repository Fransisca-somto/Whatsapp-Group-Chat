"use client";

import {
  dayLabelInTz,
  formatPhoneForDisplay,
  localDateInTz,
  timeOfDayInTz,
} from "@soft-agent-support/shared";
import { AtSign, Loader2 } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import type * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GROUP_MESSAGES_PAGE, MEDIA_PLACEHOLDER, type GroupMessageView } from "@/lib/groups";
import { cn } from "@/lib/utils";
import { loadOlderGroupMessages } from "@/server/actions/groups";

type Props = {
  groupId: string;
  /** Newest first, as the server reads them. */
  initial: GroupMessageView[];
  timeZone: string;
  /** The bot's name from Settings. */
  botName: string;
  /** The numbers WhatsApp uses in "@…" mentions of the bot (phone and LID). */
  botMentionIds: string[];
};

function senderLabel(message: GroupMessageView, botName: string): string {
  if (message.is_from_bot) return botName;
  if (message.sender_name) return message.sender_name;
  if (message.sender_phone_e164) return formatPhoneForDisplay(message.sender_phone_e164);
  return "Unknown sender";
}

/** Same person and same day → one run of bubbles under one name. */
function senderKey(message: GroupMessageView): string {
  return message.is_from_bot
    ? "bot"
    : (message.sender_phone_e164 ?? message.sender_name ?? message.id);
}

/** Turns "@52055741849776" into a highlighted "@Assistant"; other text is left as it is. */
function renderBody(body: string, botName: string, botMentionIds: string[]): React.ReactNode[] {
  return body.split(/(@[0-9]{5,})/g).map((part, index) => {
    if (part.startsWith("@") && botMentionIds.includes(part.slice(1))) {
      return (
        <span key={index} className="font-medium text-primary">
          @{botName}
        </span>
      );
    }
    return part;
  });
}

function plainBody(message: GroupMessageView, botName: string, botMentionIds: string[]): string {
  if (!message.body) return MEDIA_PLACEHOLDER[message.message_type] ?? "Message";
  return botMentionIds
    .reduce((text, id) => text.replaceAll(`@${id}`, `@${botName}`), message.body)
    .replace(/\s+/g, " ")
    .trim();
}

/** The group's messages as a chat: oldest at the top, bot on the right, "Load older" on top. */
export function GroupMessages({ groupId, initial, timeZone, botName, botMentionIds }: Props) {
  const [messages, setMessages] = useState(initial);
  const [hasMore, setHasMore] = useState(initial.length === GROUP_MESSAGES_PAGE);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Scroll height before older messages were added, to keep the reader's place. */
  const keepPlaceFrom = useRef<number | null>(null);

  // Open at the newest message, like a chat app.
  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box || keepPlaceFrom.current === null) return;
    box.scrollTop += box.scrollHeight - keepPlaceFrom.current;
    keepPlaceFrom.current = null;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No messages stored yet. Messages appear here once the group is approved.
      </p>
    );
  }

  const loadOlder = () => {
    const oldest = messages.at(-1);
    if (!oldest) return;
    startTransition(async () => {
      const result = await loadOlderGroupMessages({ groupId, before: oldest.sent_at });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      keepPlaceFrom.current = scrollRef.current?.scrollHeight ?? null;
      setMessages((current) => [...current, ...result.data]);
      setHasMore(result.data.length === GROUP_MESSAGES_PAGE);
    });
  };

  const chronological = [...messages].reverse();
  const byWaId = new Map(messages.map((message) => [message.wa_message_id, message]));

  return (
    <div
      ref={scrollRef}
      className="max-h-[65vh] min-h-48 overflow-y-auto rounded-lg border bg-background p-3 sm:p-4"
    >
      {hasMore && (
        <div className="mb-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={loadOlder} disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            Load older
          </Button>
        </div>
      )}
      <ol className="flex flex-col" aria-label="Messages, oldest first">
        {chronological.map((message, index) => {
          const previous = chronological[index - 1];
          const day = localDateInTz(message.sent_at, timeZone);
          const newDay = !previous || localDateInTz(previous.sent_at, timeZone) !== day;
          const newRun = newDay || !previous || senderKey(previous) !== senderKey(message);
          const fromBot = message.is_from_bot;
          const quoted = message.quoted_wa_message_id
            ? byWaId.get(message.quoted_wa_message_id)
            : undefined;

          return (
            <Fragment key={message.id}>
              {newDay && (
                <li className="my-3 flex justify-center first:mt-0">
                  <span className="rounded-full border bg-surface px-3 py-0.5 text-xs text-muted-foreground">
                    {dayLabelInTz(message.sent_at, timeZone)}
                  </span>
                </li>
              )}
              <li
                className={cn(
                  "flex flex-col",
                  fromBot ? "items-end" : "items-start",
                  newRun ? "mt-3" : "mt-1",
                )}
              >
                {newRun && (
                  <span className="mb-1 px-1 text-xs font-medium text-muted-foreground">
                    {senderLabel(message, botName)}
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl border px-3 py-2 text-sm sm:max-w-[75%]",
                    fromBot
                      ? "rounded-tr-sm border-primary/20 bg-primary/10"
                      : "rounded-tl-sm bg-surface",
                  )}
                >
                  {quoted && (
                    <div className="mb-1.5 rounded-md border-l-2 border-primary bg-background/60 px-2 py-1 text-xs">
                      <span className="font-medium">{senderLabel(quoted, botName)}</span>
                      <p className="line-clamp-2 text-muted-foreground">
                        {plainBody(quoted, botName, botMentionIds)}
                      </p>
                    </div>
                  )}
                  {message.body ? (
                    <p className="whitespace-pre-wrap break-words">
                      {renderBody(message.body, botName, botMentionIds)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground italic">
                      {MEDIA_PLACEHOLDER[message.message_type] ?? "Message"}
                    </p>
                  )}
                  <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                    {message.mentions_bot && (
                      <span
                        className="inline-flex items-center text-status-info"
                        title="Tagged the bot"
                      >
                        <AtSign aria-hidden="true" className="size-3" />
                        <span className="sr-only">Tagged</span>
                      </span>
                    )}
                    <time dateTime={message.sent_at}>
                      {timeOfDayInTz(message.sent_at, timeZone)}
                    </time>
                  </p>
                </div>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
