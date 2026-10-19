"use client";

import { formatPhoneForDisplay } from "@soft-agent-support/shared";
import { AtSign, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { DateTimeInCompanyTz } from "@/components/DateTimeInCompanyTz";
import { Button } from "@/components/ui/button";
import { GROUP_MESSAGES_PAGE, MEDIA_PLACEHOLDER, type GroupMessageView } from "@/lib/groups";
import { loadOlderGroupMessages } from "@/server/actions/groups";

function senderLabel(message: GroupMessageView): string {
  if (message.is_from_bot) return "Bot";
  if (message.sender_name) return message.sender_name;
  if (message.sender_phone_e164) return formatPhoneForDisplay(message.sender_phone_e164);
  return "Unknown sender";
}

/** Read-only message history, newest first, with "Load older" paging. */
export function GroupMessages({
  groupId,
  initial,
  timeZone,
}: {
  groupId: string;
  initial: GroupMessageView[];
  timeZone: string;
}) {
  const [messages, setMessages] = useState(initial);
  const [hasMore, setHasMore] = useState(initial.length === GROUP_MESSAGES_PAGE);
  const [pending, startTransition] = useTransition();

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
      setMessages((current) => [...current, ...result.data]);
      setHasMore(result.data.length === GROUP_MESSAGES_PAGE);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col divide-y divide-border">
        {messages.map((message) => (
          <li key={message.id} className="flex flex-col gap-1 py-3 first:pt-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{senderLabel(message)}</span>
              <DateTimeInCompanyTz value={message.sent_at} timeZone={timeZone} />
              {message.mentions_bot && (
                <span className="inline-flex items-center gap-1 rounded-full border border-status-info/30 bg-status-info/10 px-2 py-0.5 font-medium text-status-info">
                  <AtSign aria-hidden="true" className="size-3" />
                  Tagged
                </span>
              )}
            </div>
            {message.body ? (
              <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {MEDIA_PLACEHOLDER[message.message_type] ?? "Message"}
              </p>
            )}
          </li>
        ))}
      </ol>
      {hasMore && (
        <Button variant="outline" onClick={loadOlder} disabled={pending} className="w-fit">
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          Load older
        </Button>
      )}
    </div>
  );
}
