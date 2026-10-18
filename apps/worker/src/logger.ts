// Structured JSON logging (architecture.md §1). Local readability comes from piping through
// pino-pretty in the `dev` script, so production output stays plain JSON.
import { pino, type Logger } from "pino";

export type { Logger };

/** Field paths that must never reach the logs, whatever object they appear in. */
const REDACT_PATHS = [
  "*.SUPABASE_SERVICE_ROLE_KEY",
  "*.SESSION_ENCRYPTION_KEY",
  "*.OPENROUTER_API_KEY",
  "*.EMBEDDINGS_API_KEY",
  "*.META_CLOUD_API_TOKEN",
  "*.apiKey",
  "*.token",
  "*.authorization",
  "*.Authorization",
  "*.creds",
  "*.keys",
  "*.value_enc",
  "*.pairingCode",
  "*.pairing_code",
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: "worker" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  });
}
