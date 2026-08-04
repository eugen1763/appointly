import { describe, expect, it } from "vitest";

import { safeReturnPath, signInPathFor } from "./return-path";

describe("safeReturnPath", () => {
  it("keeps an app-local path with its query and fragment", () => {
    expect(safeReturnPath("/dashboard?view=recent#owned", "/dashboard"))
      .toBe("/dashboard?view=recent#owned");
  });

  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "dashboard",
    "javascript:alert(1)",
    "",
  ])("rejects the unsafe return value %j", (returnTo) => {
    expect(safeReturnPath(returnTo, "/dashboard")).toBe("/dashboard");
  });

  it("rejects non-string query values", () => {
    expect(safeReturnPath(["/dashboard", "//attacker.example"], "/dashboard"))
      .toBe("/dashboard");
  });
});

describe("signInPathFor", () => {
  it("encodes the safe app-local return path", () => {
    expect(signInPathFor("/appointments/new"))
      .toBe("/sign-in?returnTo=%2Fappointments%2Fnew");
  });
});
