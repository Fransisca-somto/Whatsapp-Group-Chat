import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import type { AlertKind } from "@soft-agent-support/shared";

import type { AlertStore } from "../db/alertsRepo.ts";
import { createAlerter } from "./alerts.ts";
import type { EmailMessage } from "./email.ts";

const logger = pino({ level: "silent" });

function setup(options: { failEmail?: boolean } = {}) {
  const rows: { kind: AlertKind; key: string; sent: boolean; resolved: boolean }[] = [];
  const configureDatabaseEmail = vi.fn(() => Promise.resolve());
  const store: AlertStore = {
    hasOpen: (kind) => Promise.resolve(rows.some((r) => r.kind === kind && !r.resolved)),
    open: (kind, key) => {
      if (rows.some((r) => r.key === key)) return Promise.resolve(false);
      rows.push({ kind, key, sent: false, resolved: false });
      return Promise.resolve(true);
    },
    markSent: (key) => {
      const row = rows.find((r) => r.key === key);
      if (row) row.sent = true;
      return Promise.resolve();
    },
    resolve: (kinds) => {
      let n = 0;
      for (const row of rows) {
        if (kinds.includes(row.kind) && !row.resolved) {
          row.resolved = true;
          n += 1;
        }
      }
      return Promise.resolve(n);
    },
    companyTimezone: () => Promise.resolve("Africa/Lagos"),
    configureDatabaseEmail,
  };
  const sent: EmailMessage[] = [];
  const email = {
    send: vi.fn((message: EmailMessage) => {
      if (options.failEmail) return Promise.reject(new Error("Resend down"));
      sent.push(message);
      return Promise.resolve({ id: `email-${sent.length}` });
    }),
  };
  let clock = Date.parse("2026-10-18T14:00:00Z");
  const alerter = createAlerter({
    store,
    email,
    recipients: ["owner@example.com"],
    apiKey: "re_test",
    from: "Group Assistant <onboarding@resend.dev>",
    logger,
    dashboardUrl: "https://dash.example.com",
    now: () => new Date((clock += 1000)),
  });
  return { alerter, rows, sent, configureDatabaseEmail };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("owner alerts", () => {
  it("emails the owner with what happened, when, and what to do", async () => {
    const { alerter, sent, rows } = setup();
    alerter.notify("logged_out", "logged out");
    await alerter.resolve([]); // waits for the queue

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(["owner@example.com"]);
    expect(sent[0]?.subject).toBe("[Group Assistant] Bot logged out of WhatsApp");
    expect(sent[0]?.text).toContain("Detail: logged out");
    expect(sent[0]?.text).toContain("Connection and link the number again");
    expect(sent[0]?.text).toContain("https://dash.example.com/connection");
    expect(rows[0]).toMatchObject({ kind: "logged_out", sent: true, resolved: false });
  });

  it("sends one email per incident, even for repeated events", async () => {
    const { alerter, sent } = setup();
    alerter.notify("conflict", "replaced");
    alerter.notify("conflict", "replaced again");
    await alerter.resolve([]);
    expect(sent).toHaveLength(1);
  });

  it("alerts again after the incident is resolved", async () => {
    const { alerter, sent } = setup();
    alerter.notify("reconnect_failures", "10 attempts");
    await alerter.resolve(["logged_out", "conflict", "reconnect_failures"]);
    alerter.notify("reconnect_failures", "10 attempts");
    await alerter.resolve([]);
    expect(sent).toHaveLength(2);
  });

  it("keeps different kinds independent", async () => {
    const { alerter, sent } = setup();
    alerter.notify("reconnect_failures", "10 attempts");
    alerter.notify("logged_out", "logged out");
    await alerter.resolve([]);
    expect(sent.map((m) => m.subject)).toEqual([
      "[Group Assistant] Bot keeps failing to reconnect",
      "[Group Assistant] Bot logged out of WhatsApp",
    ]);
  });

  it("never throws into the caller when email fails, and leaves the alert unsent", async () => {
    const { alerter, rows } = setup({ failEmail: true });
    expect(() => alerter.notify("logged_out", "logged out")).not.toThrow();
    await settle();
    await alerter.resolve([]);
    expect(rows[0]).toMatchObject({ sent: false });
  });

  it("passes the email settings to the database", async () => {
    const { alerter, configureDatabaseEmail } = setup();
    await alerter.configureDatabase();
    expect(configureDatabaseEmail).toHaveBeenCalledWith(
      "re_test",
      ["owner@example.com"],
      "Group Assistant <onboarding@resend.dev>",
    );
  });
});
