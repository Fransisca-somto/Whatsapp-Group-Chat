// Worker environment variables (architecture.md §8). Parsed once on boot; the worker exits
// with a readable list of problems if anything is missing or malformed. Error messages name
// the variable and the rule, never the value, so secrets cannot leak into logs.
//
// Variables are required by the task that first uses them (ADR-024): Supabase, the session key
// and owner alert email. The OpenRouter key and models are not environment variables: the owner
// sets them on the dashboard Settings page (ADR-027), and search uses the same key with a fixed
// embedding model (ADR-031).
import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

/** `.env.example` ships keys with empty values; treat "" the same as unset. */
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

function required<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema);
}

const encryptionKeySchema = z
  .string({ error: "is required" })
  .refine((value) => Buffer.from(value, "base64").length === 32, {
    message: "must be 32 bytes encoded as base64 (generate with: openssl rand -base64 32)",
  });

/** Comma-separated list of email addresses, e.g. "a@x.com, b@y.com". */
const emailListSchema = z
  .string({ error: "is required" })
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.email({ error: "must be comma-separated email addresses" }))
      .min(1, "must list at least one email address"),
  );

const envSchema = z.object({
  SUPABASE_URL: required(z.url({ error: "must be a valid URL" })),
  SUPABASE_SERVICE_ROLE_KEY: required(z.string({ error: "is required" }).min(1)),
  SESSION_ENCRYPTION_KEY: required(encryptionKeySchema),

  // Owner alerts by email through Resend (ADR-025).
  RESEND_API_KEY: required(z.string({ error: "is required" }).min(1)),
  OWNER_ALERT_EMAILS: required(emailListSchema),
  ALERT_FROM_EMAIL: optional(z.string().min(3)).transform(
    (value) => value ?? "Group Assistant <onboarding@resend.dev>",
  ),
  DASHBOARD_URL: optional(z.url({ error: "must be a valid URL" })),

  LOG_LEVEL: optional(
    z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(", ")}` }),
  ).transform((value) => value ?? "info"),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid worker environment:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/** Parses the given environment (usually `process.env`). Throws `EnvError` listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): WorkerEnv {
  const result = envSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join(".");
    // A missing value surfaces as a type error on `undefined`; report it plainly.
    const message = issue.code === "invalid_type" ? "is required" : issue.message;
    return `${name} ${message}`;
  });
  throw new EnvError(problems);
}
