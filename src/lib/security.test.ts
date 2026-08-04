import type * as CryptoModule from "node:crypto";

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { compareCalls } = vi.hoisted(() => ({
  compareCalls: [] as Array<{ candidate: Buffer; expected: Buffer }>,
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  return {
    ...actual,
    timingSafeEqual(candidate: NodeJS.ArrayBufferView, expected: NodeJS.ArrayBufferView) {
      compareCalls.push({
        candidate: Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength),
        expected: Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
      });
      return actual.timingSafeEqual(candidate, expected);
    },
  };
});

import {
  createDeleteConfirmationDigester,
  createRateKeyDigester,
  encodeDeleteConfirmationToken,
  verifyDeleteConfirmationToken,
} from "./security";

const MASTER_SECRET = Buffer.alloc(32, 0x5a);

beforeEach(() => {
  compareCalls.length = 0;
});

describe("delete confirmation security", () => {
  it("derives a delete-domain key and preserves uint32-prefixed UTF-8 part boundaries", () => {
    const digester = createDeleteConfirmationDigester(MASTER_SECRET);
    const deleteKey = createHmac("sha256", MASTER_SECRET)
      .update("appointly/delete/v1", "utf8")
      .digest();
    const expected = createHmac("sha256", deleteKey)
      .update(Buffer.from([0, 0, 0, 2]))
      .update("é", "utf8")
      .update(Buffer.from([0, 0, 0, 1]))
      .update("c", "utf8")
      .digest();

    expect(digester.digestDeleteConfirmation("é", "c")).toEqual(expected);
    expect(digester.digestDeleteConfirmation("ab", "c"))
      .not.toEqual(digester.digestDeleteConfirmation("a", "bc"));
    expect(digester.digestDeleteConfirmation("appointment", "option"))
      .not.toEqual(createRateKeyDigester(MASTER_SECRET).digestRateKey("appointment", "option"));
  });

  it("produces deterministic confirmation digests from lexically sorted participant IDs", () => {
    const digester = createDeleteConfirmationDigester(MASTER_SECRET);
    const participantIds = ["participant-z", "participant-a", "participant-m"];
    const first = digester.digestDeleteConfirmation(
      "appointment",
      "option",
      ...[...participantIds].sort(),
    );
    const second = digester.digestDeleteConfirmation(
      "appointment",
      "option",
      ...[...participantIds].reverse().sort(),
    );

    expect(first).toEqual(second);
  });

  it("encodes only 32-byte digests as canonical unpadded base64url", () => {
    const digest = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    const token = encodeDeleteConfirmationToken(digest);

    expect(token).toBe(digest.toString("base64url"));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(() => encodeDeleteConfirmationToken(Buffer.alloc(31))).toThrow(/32 bytes/u);
  });

  it("uses one equal-length constant-time comparison and rejects malformed or stale tokens", () => {
    const expected = Buffer.alloc(32, 0x7c);
    const validToken = encodeDeleteConfirmationToken(expected);

    expect(verifyDeleteConfirmationToken(validToken, expected)).toBe(true);
    expect(compareCalls).toEqual([{ candidate: expected, expected }]);

    compareCalls.length = 0;
    expect(verifyDeleteConfirmationToken(Buffer.alloc(32, 0x7d).toString("base64url"), expected))
      .toBe(false);
    expect(compareCalls).toHaveLength(1);
    expect(compareCalls[0]?.candidate).toHaveLength(32);
    expect(compareCalls[0]?.expected).toEqual(expected);

    compareCalls.length = 0;
    for (const malformed of [undefined, "", "A".repeat(42), "_".repeat(43), `${validToken}=`]) {
      expect(verifyDeleteConfirmationToken(malformed, expected)).toBe(false);
      expect(compareCalls.at(-1)?.candidate).toHaveLength(32);
      expect(compareCalls.at(-1)?.expected).toEqual(expected);
    }
    expect(compareCalls).toHaveLength(5);
  });

  it("requires at least 32 secret bytes", () => {
    expect(() => createDeleteConfirmationDigester(Buffer.alloc(31))).toThrow(/32 bytes/u);
  });
});
