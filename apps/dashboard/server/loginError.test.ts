import { describe, expect, it } from "vitest";

import { LOGIN_MESSAGES, loginErrorMessage } from "./loginError";

describe("loginErrorMessage", () => {
  it("blames the password only for a credentials rejection", () => {
    expect(loginErrorMessage({ status: 400, code: "invalid_credentials" })).toBe(
      LOGIN_MESSAGES.invalid,
    );
  });

  it("reports network failures and outages as unreachable", () => {
    // supabase-js reports "fetch failed" as AuthRetryableFetchError with status 0.
    expect(loginErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toBe(
      LOGIN_MESSAGES.unreachable,
    );
    expect(loginErrorMessage({ status: 503 })).toBe(LOGIN_MESSAGES.unreachable);
    expect(loginErrorMessage({})).toBe(LOGIN_MESSAGES.unreachable);
  });

  it("explains rate limiting", () => {
    expect(loginErrorMessage({ status: 429, code: "over_request_rate_limit" })).toBe(
      LOGIN_MESSAGES.rateLimited,
    );
  });

  it("falls back to a generic message", () => {
    expect(loginErrorMessage({ status: 403, code: "email_not_confirmed" })).toBe(
      LOGIN_MESSAGES.unknown,
    );
  });
});
