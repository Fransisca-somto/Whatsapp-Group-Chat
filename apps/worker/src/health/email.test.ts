import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { createResendSender, EmailError } from "./email.ts";

const logger = pino({ level: "silent" });
const message = { to: ["owner@example.com"], subject: "Test", text: "Hello" };

function sender(fetchImpl: typeof fetch) {
  return createResendSender({
    apiKey: "re_test",
    from: "Group Assistant <onboarding@resend.dev>",
    logger,
    fetchImpl,
    retryDelayMs: 0,
  });
}

const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("Resend sender", () => {
  it("posts the message with the key and sender", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => reply(200, { id: "email-1" }));
    await expect(sender(fetchImpl).send(message)).resolves.toEqual({ id: "email-1" });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer re_test" });
    expect(JSON.parse(init?.body as string)).toEqual({
      from: "Group Assistant <onboarding@resend.dev>",
      ...message,
    });
  });

  it("retries once on a server error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => reply(502, { message: "bad gateway" }))
      .mockImplementationOnce(() => reply(200, { id: "email-2" }));
    await expect(sender(fetchImpl).send(message)).resolves.toEqual({ id: "email-2" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once on a network failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementationOnce(() => reply(200, { id: "email-3" }));
    await expect(sender(fetchImpl).send(message)).resolves.toEqual({ id: "email-3" });
  });

  it("does not retry a rejected request (e.g. unverified recipient)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => reply(403, { message: "verify a domain" }));
    await expect(sender(fetchImpl).send(message)).rejects.toBeInstanceOf(EmailError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
