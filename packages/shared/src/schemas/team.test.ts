import { describe, expect, it } from "vitest";

import {
  changePasswordInputSchema,
  createOwnerInputSchema,
  createStaffInputSchema,
} from "./team.ts";

describe("createOwnerInputSchema", () => {
  const valid = {
    companyName: " Acme Ltd ",
    timezone: "Africa/Lagos",
    displayName: "Ada",
    email: " Ada@Example.com ",
    temporaryPassword: "temp-pass-123",
  };

  it("accepts a new owner and tidies the email", () => {
    const parsed = createOwnerInputSchema.parse(valid);
    expect(parsed.companyName).toBe("Acme Ltd");
    expect(parsed.email).toBe("ada@example.com");
  });

  it("rejects a bad time zone, email or short password", () => {
    expect(createOwnerInputSchema.safeParse({ ...valid, timezone: "Mars/Base" }).success).toBe(
      false,
    );
    expect(createOwnerInputSchema.safeParse({ ...valid, email: "ada" }).success).toBe(false);
    expect(createOwnerInputSchema.safeParse({ ...valid, temporaryPassword: "short" }).success).toBe(
      false,
    );
  });
});

describe("createStaffInputSchema", () => {
  it("needs a name, email and temporary password", () => {
    expect(
      createStaffInputSchema.safeParse({
        displayName: "Bo",
        email: "bo@example.com",
        temporaryPassword: "temp-pass-123",
      }).success,
    ).toBe(true);
    expect(
      createStaffInputSchema.safeParse({ displayName: "", email: "bo@example.com" }).success,
    ).toBe(false);
  });
});

describe("changePasswordInputSchema", () => {
  it("requires matching passwords of 8–72 characters", () => {
    expect(
      changePasswordInputSchema.safeParse({ password: "new-pass-123", confirm: "new-pass-123" })
        .success,
    ).toBe(true);
    expect(
      changePasswordInputSchema.safeParse({ password: "new-pass-123", confirm: "new-pass-124" })
        .success,
    ).toBe(false);
    expect(
      changePasswordInputSchema.safeParse({ password: "a".repeat(73), confirm: "a".repeat(73) })
        .success,
    ).toBe(false);
  });
});
