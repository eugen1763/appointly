import { describe, expect, it } from "vitest";

import {
  DIRECT_CLIENT_RATE_KEY,
  resolveJoinClientKey,
} from "./route-support";

function request(forwardedFor?: string): Request {
  return new Request("https://appointments.example/api/appointments/abcdefghijklmnopqrstuvwx/participants", {
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  });
}

describe("resolveJoinClientKey", () => {
  it.each([
    [undefined],
    ["198.51.100.7"],
    ["198.51.100.7, 10.0.0.4"],
  ])("ignores X-Forwarded-For when proxy trust is disabled", (forwardedFor) => {
    expect(resolveJoinClientKey(request(forwardedFor), false)).toBe(DIRECT_CLIENT_RATE_KEY);
  });

  it("uses only the trimmed leftmost value from an overwriting trusted proxy", () => {
    expect(resolveJoinClientKey(request(" 2001:db8::1 , 10.0.0.4, 10.0.0.5"), true))
      .toBe("2001:db8::1");
  });

  it.each([undefined, "", "   ", " , 198.51.100.8", "unknown, 198.51.100.8"])(
    "uses the direct bucket for an absent, empty, or invalid trusted value",
    (forwardedFor) => {
      expect(resolveJoinClientKey(request(forwardedFor), true)).toBe(DIRECT_CLIENT_RATE_KEY);
    },
  );
});
