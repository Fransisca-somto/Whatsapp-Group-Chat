// Owner alerts raised by the worker itself (api-interfaces.md §7): logged out, conflict and
// repeated reconnect failures. One email per incident: an incident stays open until the bot
// connects again, so restarts and repeated events never send a second email.
// The "worker offline" alert is raised by the database instead (migration 0008).
import { formatInCompanyTz, type AlertKind } from "@soft-agent-support/shared";

import type { AlertStore } from "../db/alertsRepo.ts";
import type { Logger } from "../logger.ts";
import type { EmailSender } from "./email.ts";

type WorkerAlertKind = Exclude<AlertKind, "offline">;

const COPY: Record<WorkerAlertKind, { subject: string; action: string }> = {
  logged_out: {
    subject: "Bot logged out of WhatsApp",
    action:
      "The saved session was cleared. Open the dashboard → Connection and link the number again. " +
      "If WhatsApp banned the number, link a spare number instead.",
  },
  conflict: {
    subject: "Another device took over the bot's WhatsApp session",
    action:
      "Check that no second copy of the worker is running and that nobody linked the number " +
      "elsewhere, then open the dashboard → Connection → Relink.",
  },
  reconnect_failures: {
    subject: "Bot keeps failing to reconnect",
    action:
      "The worker is still retrying on its own. Check the host's internet connection and the " +
      "worker logs. You will get no further email until it connects again.",
  },
};

export type Alerter = {
  /** Fire-and-forget: errors are logged, never thrown into the caller. */
  notify(kind: WorkerAlertKind, detail: string): void;
  /** Ends open incidents; call when the bot connects (and on startup for `offline`). */
  resolve(kinds: AlertKind[]): Promise<void>;
  /** Copies email settings into Vault so the database can send the offline alert. */
  configureDatabase(): Promise<void>;
};

export function createAlerter(options: {
  store: AlertStore;
  email: EmailSender;
  recipients: string[];
  apiKey: string;
  from: string;
  logger: Logger;
  dashboardUrl?: string;
  now?: () => Date;
}): Alerter {
  const { store, email, recipients, dashboardUrl, now = () => new Date() } = options;
  const log = options.logger.child({ module: "alerts" });
  let queue: Promise<void> = Promise.resolve();

  async function raise(kind: WorkerAlertKind, detail: string) {
    if (await store.hasOpen(kind)) {
      log.info({ kind }, "alert already sent for this incident");
      return;
    }
    const at = now();
    const incidentKey = `${kind}:${at.toISOString()}`;
    if (!(await store.open(kind, incidentKey))) return;

    const timeZone = await store.companyTimezone().catch(() => "UTC");
    const copy = COPY[kind];
    const text = [
      `${copy.subject}.`,
      "",
      `When: ${formatInCompanyTz(at, timeZone)}`,
      `Detail: ${detail}`,
      "",
      `What to do: ${copy.action}`,
      ...(dashboardUrl ? ["", `Dashboard: ${dashboardUrl}/connection`] : []),
    ].join("\n");

    const { id } = await email.send({
      to: recipients,
      subject: `[Group Assistant] ${copy.subject}`,
      text,
    });
    await store.markSent(incidentKey);
    log.warn({ kind, emailId: id }, "owner alert sent");
  }

  return {
    notify(kind, detail) {
      // Serialised so two quick events of the same kind cannot both pass the hasOpen check.
      queue = queue
        .then(() => raise(kind, detail))
        .catch((error: unknown) => log.error({ err: error, kind }, "owner alert failed"));
    },

    async resolve(kinds) {
      await queue;
      const resolved = await store.resolve(kinds);
      if (resolved) log.info({ kinds, resolved }, "owner alerts resolved");
    },

    async configureDatabase() {
      await store.configureDatabaseEmail(options.apiKey, recipients, options.from);
    },
  };
}
