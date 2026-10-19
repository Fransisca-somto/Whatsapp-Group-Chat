// Owner alert email through Resend's HTTP API (ADR-025). No SDK: one POST does the job.
import type { Logger } from "../logger.ts";

export type EmailMessage = { to: string[]; subject: string; text: string };

export type EmailSender = { send(message: EmailMessage): Promise<{ id: string }> };

const RESEND_URL = "https://api.resend.com/emails";

export function createResendSender(options: {
  apiKey: string;
  from: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}): EmailSender {
  const { apiKey, from, fetchImpl = fetch, timeoutMs = 10_000, retryDelayMs = 2_000 } = options;
  const log = options.logger.child({ module: "email" });

  async function attempt(message: EmailMessage): Promise<{ id: string }> {
    const response = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, ...message }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new EmailError(response.status, body.slice(0, 300));
    }
    const parsed = JSON.parse(body) as { id?: unknown };
    return { id: typeof parsed.id === "string" ? parsed.id : "unknown" };
  }

  return {
    async send(message) {
      try {
        return await attempt(message);
      } catch (error) {
        if (!isRetryable(error)) throw error;
        log.warn({ err: error }, "alert email failed; retrying once");
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return attempt(message);
      }
    },
  };
}

export class EmailError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Resend responded ${status}: ${detail}`);
    this.name = "EmailError";
  }
}

/** Network errors, timeouts, rate limits and server errors are worth one retry; 4xx are not. */
function isRetryable(error: unknown): boolean {
  if (error instanceof EmailError) return error.status === 429 || error.status >= 500;
  return true;
}
