import { describe, expect, it } from "vitest";

import { ownerDisplayNameFromIdentity } from "./creation-owner-default";

describe("ownerDisplayNameFromIdentity", () => {
  it("normalizes the signed-in Google name for the owner prefill", () => {
    expect(ownerDisplayNameFromIdentity({
      name: "  Ada\t Lovelace  ",
      email: "ada@example.com",
    })).toBe("Ada Lovelace");
  });

  it("uses and normalizes the email local part when the Google name is blank", () => {
    expect(ownerDisplayNameFromIdentity({
      name: " \n ",
      email: "  team.lead@example.com ",
    })).toBe("team.lead");
  });

  it("normalizes compatibility characters in the default", () => {
    expect(ownerDisplayNameFromIdentity({
      name: "Ａｄａ",
      email: "ada@example.com",
    })).toBe("Ada");
  });
});
