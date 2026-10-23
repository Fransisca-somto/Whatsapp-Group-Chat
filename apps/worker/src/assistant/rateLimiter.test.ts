import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./rateLimiter.ts";

describe("rate limiter", () => {
  it("allows 5 tags a minute per user, notifies once, then stays silent", () => {
    let clock = 0;
    const limiter = createRateLimiter({ now: () => clock });
    const decisions = Array.from({ length: 7 }, () => {
      clock += 1_000;
      return limiter.checkUser("ada");
    });
    expect(decisions).toEqual(["ok", "ok", "ok", "ok", "ok", "notify", "silent"]);
    expect(limiter.checkUser("tunde")).toBe("ok"); // other users are unaffected

    clock += 60_000; // the window has passed
    expect(limiter.checkUser("ada")).toBe("ok");
  });

  it("enforces the group's daily cap with one notice per day", () => {
    const limiter = createRateLimiter();
    expect(limiter.checkGroup("g1", "2026-10-22", 199, 200)).toBe("ok");
    expect(limiter.checkGroup("g1", "2026-10-22", 200, 200)).toBe("notify");
    expect(limiter.checkGroup("g1", "2026-10-22", 201, 200)).toBe("silent");
    expect(limiter.checkGroup("g1", "2026-10-23", 200, 200)).toBe("notify"); // a new day
  });
});
