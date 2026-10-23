// Rate gate (architecture.md §4 step 4; D4 confirmed by the owner): 5 tags per user per minute,
// and each group's daily reply cap. Over a limit the bot sends one short notice, then stays
// silent. Counts live in memory: the leader lock guarantees a single worker, and the daily count
// itself comes from ai_usage_daily, so a restart never resets the cap.

export type RateDecision = "ok" | "notify" | "silent";

export type RateLimiter = {
  /** Records the tag if allowed. */
  checkUser(userKey: string): RateDecision;
  /** `repliesToday` comes from ai_usage_daily for the company-timezone date. */
  checkGroup(groupId: string, usageDate: string, repliesToday: number, cap: number): RateDecision;
};

export function createRateLimiter(
  options: { perUserLimit?: number; windowMs?: number; now?: () => number } = {},
): RateLimiter {
  const { perUserLimit = 5, windowMs = 60_000, now = Date.now } = options;
  const hits = new Map<string, number[]>();
  const userNotified = new Set<string>();
  const groupNotified = new Set<string>();

  return {
    checkUser(userKey) {
      const cutoff = now() - windowMs;
      const recent = (hits.get(userKey) ?? []).filter((at) => at > cutoff);
      if (recent.length < perUserLimit) {
        recent.push(now());
        hits.set(userKey, recent);
        userNotified.delete(userKey);
        return "ok";
      }
      hits.set(userKey, recent);
      if (userNotified.has(userKey)) return "silent";
      userNotified.add(userKey);
      return "notify";
    },

    checkGroup(groupId, usageDate, repliesToday, cap) {
      if (repliesToday < cap) return "ok";
      const key = `${groupId}:${usageDate}`;
      if (groupNotified.has(key)) return "silent";
      // Keep the set small: only today's keys matter.
      for (const old of groupNotified)
        if (!old.endsWith(`:${usageDate}`)) groupNotified.delete(old);
      groupNotified.add(key);
      return "notify";
    },
  };
}
