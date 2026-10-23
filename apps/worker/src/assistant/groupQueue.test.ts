import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { createGroupQueue } from "./groupQueue.ts";

const logger = pino({ level: "silent" });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("group queue", () => {
  it("runs one task at a time per group, in order, and groups in parallel", async () => {
    const queue = createGroupQueue(logger);
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`start ${name}`);
      await tick();
      events.push(`end ${name}`);
    };
    await Promise.all([
      queue.run("g1", task("a1")),
      queue.run("g1", task("a2")),
      queue.run("g2", task("b1")),
    ]);
    expect(events.indexOf("end a1")).toBeLessThan(events.indexOf("start a2"));
    expect(events.indexOf("start b1")).toBeLessThan(events.indexOf("end a1"));
  });

  it("keeps going after a failed task", async () => {
    const queue = createGroupQueue(logger);
    const done: string[] = [];
    await Promise.all([
      queue.run("g1", () => Promise.reject(new Error("boom"))),
      queue.run("g1", () => {
        done.push("second");
        return Promise.resolve();
      }),
    ]);
    expect(done).toEqual(["second"]);
  });
});
