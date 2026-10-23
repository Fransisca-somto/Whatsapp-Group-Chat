"use client";

import {
  describeRepeat,
  formatInCompanyTz,
  localDateTimeInTz,
  resolveDueAt,
  SCHEDULED_POST_BODY_MAX,
  scheduledPostInputSchema,
  type RepeatRule,
  type ScheduledPostKind,
  type Weekday,
} from "@soft-agent-support/shared";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/DateTimePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  KIND_LABELS,
  formValuesFromPost,
  type SchedulableGroup,
  type ScheduledPostView,
} from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { createScheduledPost, updateScheduledPost } from "@/server/actions/schedule";

type Props = {
  groups: SchedulableGroup[];
  timeZone: string;
  /** The post to edit; omit to create one. */
  post?: ScheduledPostView;
  /** Pre-selects the group (the group page's Scheduled tab). */
  defaultGroupId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type RepeatChoice = "none" | RepeatRule["kind"];

const REPEAT_LABELS: Record<RepeatChoice, string> = {
  none: "Doesn't repeat",
  daily: "Every day",
  weekdays: "Every weekday (Mon–Fri)",
  weekly: "Weekly on chosen days",
  monthly: "Monthly on a day",
};

/** Monday first. */
const WEEK: { day: Weekday; short: string; name: string }[] = [
  { day: 1, short: "Mon", name: "Monday" },
  { day: 2, short: "Tue", name: "Tuesday" },
  { day: 3, short: "Wed", name: "Wednesday" },
  { day: 4, short: "Thu", name: "Thursday" },
  { day: 5, short: "Fri", name: "Friday" },
  { day: 6, short: "Sat", name: "Saturday" },
  { day: 0, short: "Sun", name: "Sunday" },
];

const MONTH_DAY_LABELS: Record<string, string> = {
  ...Object.fromEntries(Array.from({ length: 28 }, (_, i) => [String(i + 1), `Day ${i + 1}`])),
  last: "Last day of the month",
};

/** The next full hour in the company timezone, a sensible default for a new post. */
function nextHourLocal(timeZone: string): string {
  return `${localDateTimeInTz(new Date(Date.now() + 60 * 60_000), timeZone).slice(0, 14)}00`;
}

/** Weekday and day of month of a `YYYY-MM-DDTHH:mm` string, for repeat defaults. */
function calendarOf(local: string): { weekday: Weekday; day: number } {
  const [year, month, day] = local.slice(0, 10).split("-").map(Number) as [number, number, number];
  return { weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday, day };
}

/** Create or edit a reminder or announcement (ui-context.md §4 `/schedule`). */
export function ScheduledPostDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {/* Remount per post so the form always starts from that post's saved values. */}
        {props.open && <PostForm key={props.post?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function PostForm({ groups, timeZone, post, defaultGroupId, onOpenChange }: Props) {
  const router = useRouter();
  const formId = useId();
  const initial = post
    ? formValuesFromPost(post, timeZone)
    : {
        groupId: defaultGroupId ?? (groups.length === 1 ? groups[0]!.id : ""),
        kind: "announcement" as ScheduledPostKind,
        body: "",
        dueAtLocal: nextHourLocal(timeZone),
        repeat: null,
      };
  const start = calendarOf(initial.dueAtLocal);

  const [groupId, setGroupId] = useState(initial.groupId);
  const [kind, setKind] = useState<ScheduledPostKind>(initial.kind);
  const [body, setBody] = useState(initial.body);
  const [dueAtLocal, setDueAtLocal] = useState(initial.dueAtLocal);
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>(initial.repeat?.kind ?? "none");
  const [weeklyDays, setWeeklyDays] = useState<Weekday[]>(
    initial.repeat?.kind === "weekly" ? initial.repeat.days : [start.weekday],
  );
  const [monthDay, setMonthDay] = useState<number | "last">(
    initial.repeat?.kind === "monthly" ? initial.repeat.day : start.day <= 28 ? start.day : "last",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const repeat: RepeatRule | null =
    repeatChoice === "none"
      ? null
      : repeatChoice === "weekly"
        ? { kind: "weekly", days: weeklyDays }
        : repeatChoice === "monthly"
          ? { kind: "monthly", day: monthDay }
          : { kind: repeatChoice };
  const tooLong = body.trim().length > SCHEDULED_POST_BODY_MAX;
  const groupLabels = Object.fromEntries(
    groups.map((g) => [g.id, g.status === "paused" ? `${g.name} (paused)` : g.name]),
  );

  // Live preview: when it goes out first and how it repeats. Invalid input shows no preview.
  const due =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueAtLocal) &&
    (!repeat || repeat.kind !== "weekly" || repeat.days.length > 0)
      ? resolveDueAt({ dueAtLocal, repeat }, timeZone, new Date())
      : null;

  const toggleDay = (day: Weekday) =>
    setWeeklyDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    );

  const save = () => {
    const parsed = scheduledPostInputSchema.safeParse({ groupId, kind, body, dueAtLocal, repeat });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the post.");
      return;
    }
    if (due && !due.ok) {
      setError(due.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = post
        ? await updateScheduledPost({ ...parsed.data, id: post.id })
        : await createScheduledPost(parsed.data);
      if (result.ok) {
        toast.success(post ? "Post updated." : "Post scheduled.");
        onOpenChange(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{post ? "Edit post" : "New post"}</DialogTitle>
        <DialogDescription>
          The bot posts it in the group at this time. It never posts the same message twice.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-group`}>Group</Label>
        <Select
          items={groupLabels}
          value={groupId || null}
          onValueChange={(v) => setGroupId(v ?? "")}
        >
          <SelectTrigger id={`${formId}-group`} placeholder="Pick a group" />
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {groupLabels[g.id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Type</legend>
        <div className="flex gap-2">
          {(Object.keys(KIND_LABELS) as ScheduledPostKind[]).map((value) => (
            <Button
              key={value}
              type="button"
              variant={kind === value ? "default" : "outline"}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {KIND_LABELS[value]}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-body`}>Message</Label>
        <Textarea
          id={`${formId}-body`}
          rows={4}
          placeholder={
            kind === "reminder"
              ? "e.g. Submit your weekly report by 5pm."
              : "e.g. The office closes at 3pm on Friday."
          }
          value={body}
          aria-invalid={tooLong ? true : undefined}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className={tooLong ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
          {body.trim().length.toLocaleString("en")} / {SCHEDULED_POST_BODY_MAX.toLocaleString("en")}{" "}
          characters
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-due`}>{repeat ? "Starts" : "Date and time"}</Label>
        <DateTimePicker
          id={`${formId}-due`}
          value={dueAtLocal}
          onChange={setDueAtLocal}
          timeZone={timeZone}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-repeat`}>Repeat</Label>
        <Select
          items={REPEAT_LABELS}
          value={repeatChoice}
          onValueChange={(value) => setRepeatChoice((value ?? "none") as RepeatChoice)}
        >
          <SelectTrigger id={`${formId}-repeat`} />
          <SelectContent>
            {(Object.keys(REPEAT_LABELS) as RepeatChoice[]).map((value) => (
              <SelectItem key={value} value={value}>
                {REPEAT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {repeatChoice === "weekly" && (
          <div role="group" aria-label="Days of the week" className="flex flex-wrap gap-1.5">
            {WEEK.map(({ day, short, name }) => {
              const on = weeklyDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={name}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {short}
                </button>
              );
            })}
          </div>
        )}
        {repeatChoice === "monthly" && (
          <Select
            items={MONTH_DAY_LABELS}
            value={String(monthDay)}
            onValueChange={(value) =>
              setMonthDay(value === "last" || value === null ? "last" : Number(value))
            }
          >
            <SelectTrigger aria-label="Day of the month" />
            <SelectContent>
              {Object.keys(MONTH_DAY_LABELS).map((value) => (
                <SelectItem key={value} value={value}>
                  {MONTH_DAY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {repeat && (
          <p className="text-xs text-muted-foreground">
            Repeats until you cancel it. Days 29–31 aren&apos;t offered because not every month has
            them.
          </p>
        )}
      </div>

      <div
        className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
        aria-live="polite"
      >
        <p className="text-xs font-medium text-muted-foreground">What the group will see</p>
        <p className="whitespace-pre-wrap">
          {kind === "reminder" && <strong>Reminder: </strong>}
          {body.trim() || <span className="text-muted-foreground">Your message</span>}
        </p>
        {due?.ok && (
          <p className="text-xs text-muted-foreground">
            {repeat ? "First post " : "Posts "}
            {formatInCompanyTz(due.dueAt, timeZone)}
            {repeat && ` · ${describeRepeat(repeat, due.dueAt, timeZone)}`}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending || tooLong || groups.length === 0}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {post ? "Save changes" : "Schedule post"}
        </Button>
      </DialogFooter>
    </form>
  );
}
