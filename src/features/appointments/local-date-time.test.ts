import { beforeEach, describe, expect, it } from "vitest";

import { localTimeToUtc } from "./local-date-time";

beforeEach(() => {
  process.env.TZ = "America/New_York";
});

describe("localTimeToUtc", () => {
  it("rejects a wall time that normalizes through a daylight-saving gap", () => {
    expect(() => localTimeToUtc("2030-03-10T02:30")).toThrow(
      "Enter a real local date and time.",
    );
  });

  it("rejects an instant that converts outside canonical four-digit UTC", () => {
    expect(() => localTimeToUtc("9999-12-31T23:59")).toThrow(
      "Enter a real local date and time.",
    );
  });
});
