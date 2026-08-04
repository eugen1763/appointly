import { describe, expect, it } from "vitest";

import {
  hasOptionCapacity,
  isValidCoOrganizerCount,
  isValidDescriptionLength,
  isValidDisplayNameLength,
  isValidOptionLimit,
  isValidParticipantCount,
  isValidTitleLength,
  normalizeParticipantName,
} from "./validation";

describe("normalizeParticipantName", () => {
  it("makes NFKC-equivalent names equal for comparison", () => {
    expect(normalizeParticipantName("Ａｌｉｃｅ").normalizedName).toBe("alice");
    expect(normalizeParticipantName("Alice").normalizedName).toBe("alice");
  });

  it("trims Unicode whitespace from the outside", () => {
    expect(normalizeParticipantName("\u2003\u00a0Ada Lovelace\u3000")).toEqual({
      displayName: "Ada Lovelace",
      normalizedName: "ada lovelace",
    });
  });

  it("collapses mixed internal whitespace to one space", () => {
    expect(normalizeParticipantName("Ada\t \n\u00a0\u2003Lovelace")).toEqual({
      displayName: "Ada Lovelace",
      normalizedName: "ada lovelace",
    });
  });

  it("lowercases only the comparison form", () => {
    expect(normalizeParticipantName("  McDONALD  ")).toEqual({
      displayName: "McDONALD",
      normalizedName: "mcdonald",
    });
  });

  it("allows lowercase comparison forms to expand beyond the display length", () => {
    const normalized = normalizeParticipantName("\u0130".repeat(80));

    expect(isValidDisplayNameLength(normalized.displayName)).toBe(true);
    expect(normalized.normalizedName).toBe("i\u0307".repeat(80));
  });

  it("preserves display case after compatibility normalization", () => {
    expect(normalizeParticipantName("Ａda LOVELACE")).toEqual({
      displayName: "Ada LOVELACE",
      normalizedName: "ada lovelace",
    });
  });

  it("exposes an empty normalized value for whitespace-only input", () => {
    const normalized = normalizeParticipantName("\u00a0\t\u2003");

    expect(normalized).toEqual({ displayName: "", normalizedName: "" });
    expect(isValidDisplayNameLength(normalized.displayName)).toBe(false);
  });
});

describe("Unicode code-point text bounds", () => {
  it.each([
    ["one display-name code point", "x"],
    ["80 display-name code points", "😀".repeat(80)],
  ])("accepts %s", (_case, value) => {
    expect(isValidDisplayNameLength(value)).toBe(true);
  });

  it.each([
    ["an empty display name", ""],
    ["81 display-name code points", "😀".repeat(81)],
  ])("rejects %s", (_case, value) => {
    expect(isValidDisplayNameLength(value)).toBe(false);
  });

  it.each(["x", "😀".repeat(120)])("accepts a title within 1-120 code points", (value) => {
    expect(isValidTitleLength(value)).toBe(true);
  });

  it.each(["", " \t\n\u00a0\u2003 ", "😀".repeat(121)])(
    "rejects an empty, whitespace-only, or overlong title",
    (value) => {
      expect(isValidTitleLength(value)).toBe(false);
    },
  );

  it.each([null, "", "😀".repeat(2_000)])(
    "accepts a null or 0-2,000-code-point description",
    (value) => {
      expect(isValidDescriptionLength(value)).toBe(true);
    },
  );

  it("rejects a 2,001-code-point description", () => {
    expect(isValidDescriptionLength("😀".repeat(2_001))).toBe(false);
  });
});

describe("collection and option bounds", () => {
  it.each([0, 20])("accepts co-organizer count %i", (count) => {
    expect(isValidCoOrganizerCount(count)).toBe(true);
  });

  it.each([-1, 21, 1.5])("rejects co-organizer count %s", (count) => {
    expect(isValidCoOrganizerCount(count)).toBe(false);
  });

  it.each([0, 200])("accepts participant count %i", (count) => {
    expect(isValidParticipantCount(count)).toBe(true);
  });

  it.each([-1, 201, 1.5])("rejects participant count %s", (count) => {
    expect(isValidParticipantCount(count)).toBe(false);
  });

  it.each([1, 100])("accepts option limit %i", (limit) => {
    expect(isValidOptionLimit(limit)).toBe(true);
  });

  it.each([0, 101, 1.5])("rejects option limit %s", (limit) => {
    expect(isValidOptionLimit(limit)).toBe(false);
  });

  it("allows an option while the current count is below the appointment limit", () => {
    expect(hasOptionCapacity(9, 10)).toBe(true);
  });

  it("rejects an option when the current count has reached the appointment limit", () => {
    expect(hasOptionCapacity(10, 10)).toBe(false);
  });

  it.each([
    [-1, 10],
    [1.5, 10],
    [0, 0],
    [0, 101],
  ])("rejects invalid option capacity inputs (%s, %s)", (count, limit) => {
    expect(hasOptionCapacity(count, limit)).toBe(false);
  });
});
