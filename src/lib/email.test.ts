import { describe, expect, it } from "vitest";

import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it.each([
    ["person@example.com", "person@example.com"],
    ["PERSON@EXAMPLE.COM", "person@example.com"],
    ["\t\r\n Person.Name+Invite@Gmail.COM \f\v", "person.name+invite@gmail.com"],
  ])("normalizes the single address %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it("preserves Gmail dots and plus aliases", () => {
    expect(normalizeEmail("First.Last+News@GMAIL.COM")).toBe(
      "first.last+news@gmail.com",
    );
  });

  it.each([
    "",
    "plain-address",
    "@example.com",
    "person@",
    "person@@example.com",
    "person@example.com,other@example.com",
    "person@example.com;other@example.com",
    "Person <person@example.com>",
    "person @example.com",
    "person@example .com",
  ])("rejects invalid or multiple addresses %j", (input) => {
    expect(() => normalizeEmail(input)).toThrow();
  });

  it.each([
    "\u00a0person@example.com",
    "person@example.com\u00a0",
    "\u2003person@example.com",
    "person@example.com\u2003",
  ])("does not trim Unicode whitespace in %j", (input) => {
    expect(() => normalizeEmail(input)).toThrow();
  });
});
