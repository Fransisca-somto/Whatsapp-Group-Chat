import { describe, expect, it } from "vitest";

import { SHARED_PACKAGE_NAME } from "./index.ts";

describe("shared package", () => {
  it("exposes its package name", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@soft-agent-support/shared");
  });
});
