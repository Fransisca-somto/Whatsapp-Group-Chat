import { describe, expect, it } from "vitest";

import { EnvError, parseEnv } from "./env.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

const valid = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  SESSION_ENCRYPTION_KEY: KEY,
  RESEND_API_KEY: "re_test",
  OWNER_ALERT_EMAILS: "owner@example.com",
};

function problemsFor(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("accepts the minimum required variables and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.SUPABASE_URL).toBe(valid.SUPABASE_URL);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.EMBEDDINGS_MODEL).toBe("text-embedding-3-small");
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it("lists every missing required variable at once", () => {
    const problems = problemsFor({});
    expect(problems).toEqual([
      "SUPABASE_URL is required",
      "SUPABASE_SERVICE_ROLE_KEY is required",
      "SESSION_ENCRYPTION_KEY is required",
      "RESEND_API_KEY is required",
      "OWNER_ALERT_EMAILS is required",
    ]);
  });

  it("treats empty strings as missing", () => {
    const problems = problemsFor({ ...valid, SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(problems).toEqual(["SUPABASE_SERVICE_ROLE_KEY is required"]);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    const short = Buffer.alloc(16, 1).toString("base64");
    const problems = problemsFor({ ...valid, SESSION_ENCRYPTION_KEY: short });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^SESSION_ENCRYPTION_KEY must be 32 bytes/);
  });

  it("rejects a malformed URL, email list and log level", () => {
    const problems = problemsFor({
      ...valid,
      SUPABASE_URL: "not a url",
      OWNER_ALERT_EMAILS: "owner@example.com, not-an-email",
      LOG_LEVEL: "loud",
    });
    expect(problems.map((p) => p.split(/[ .]/)[0])).toEqual([
      "SUPABASE_URL",
      "OWNER_ALERT_EMAILS",
      "LOG_LEVEL",
    ]);
  });

  it("splits the alert email list and defaults the sender", () => {
    const env = parseEnv({ ...valid, OWNER_ALERT_EMAILS: " a@example.com, b@example.com ," });
    expect(env.OWNER_ALERT_EMAILS).toEqual(["a@example.com", "b@example.com"]);
    expect(env.ALERT_FROM_EMAIL).toBe("Group Assistant <onboarding@resend.dev>");
  });

  it("never includes secret values in error messages", () => {
    const secret = "super-secret-value-123";
    const error = (() => {
      try {
        parseEnv({ ...valid, SUPABASE_URL: secret, SESSION_ENCRYPTION_KEY: secret });
      } catch (e) {
        return e as Error;
      }
      throw new Error("expected parseEnv to throw");
    })();
    expect(error.message).not.toContain(secret);
  });
});
