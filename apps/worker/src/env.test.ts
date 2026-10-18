import { describe, expect, it } from "vitest";

import { EnvError, parseEnv } from "./env.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

const valid = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  SESSION_ENCRYPTION_KEY: KEY,
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

  it("rejects a malformed URL, phone and log level", () => {
    const problems = problemsFor({
      ...valid,
      SUPABASE_URL: "not a url",
      OWNER_ALERT_PHONE: "08012345678",
      LOG_LEVEL: "loud",
    });
    expect(problems.map((p) => p.split(" ")[0])).toEqual([
      "SUPABASE_URL",
      "OWNER_ALERT_PHONE",
      "LOG_LEVEL",
    ]);
  });

  it("normalises the owner alert phone to E.164", () => {
    const env = parseEnv({ ...valid, OWNER_ALERT_PHONE: "+234 801 234 5678" });
    expect(env.OWNER_ALERT_PHONE).toBe("+2348012345678");
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
