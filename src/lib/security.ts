import { createHmac, timingSafeEqual } from "node:crypto";

import { getEnv } from "./env";

export const EDIT_HMAC_DOMAIN = "appointly/edit/v1";
export const SESSION_HMAC_DOMAIN = "appointly/session/v1";
export const RATE_HMAC_DOMAIN = "appointly/rate/v1";
export const DELETE_HMAC_DOMAIN = "appointly/delete/v1";

export type HmacDomain =
  | typeof EDIT_HMAC_DOMAIN
  | typeof SESSION_HMAC_DOMAIN
  | typeof RATE_HMAC_DOMAIN
  | typeof DELETE_HMAC_DOMAIN;

export interface GuestTokenDigester {
  digestEditToken(token: Uint8Array): Buffer;
  digestSessionToken(token: Uint8Array): Buffer;
}

export interface RateKeyDigester {
  digestRateKey(...parts: readonly string[]): Buffer;
}

export interface DeleteConfirmationDigester {
  digestDeleteConfirmation(...parts: readonly string[]): Buffer;
}

function deriveKey(masterSecret: Uint8Array, domain: HmacDomain): Buffer {
  return createHmac("sha256", masterSecret).update(domain, "utf8").digest();
}

export function createGuestTokenDigester(
  masterSecret: Uint8Array,
): GuestTokenDigester {
  if (masterSecret.byteLength < 32) {
    throw new RangeError("Guest token master key must contain at least 32 bytes");
  }
  const editKey = deriveKey(masterSecret, EDIT_HMAC_DOMAIN);
  const sessionKey = deriveKey(masterSecret, SESSION_HMAC_DOMAIN);
  return Object.freeze({
    digestEditToken(token: Uint8Array): Buffer {
      return createHmac("sha256", editKey).update(token).digest();
    },
    digestSessionToken(token: Uint8Array): Buffer {
      return createHmac("sha256", sessionKey).update(token).digest();
    },
  });
}

function digestTextPartsWithKey(
  key: Uint8Array,
  parts: readonly string[],
): Buffer {
  const digest = createHmac("sha256", key);
  const lengthPrefix = Buffer.allocUnsafe(4);

  for (const part of parts) {
    const byteLength = Buffer.byteLength(part, "utf8");
    if (byteLength > 0xffff_ffff) {
      throw new RangeError("HMAC text part exceeds the uint32 length limit");
    }
    lengthPrefix.writeUInt32BE(byteLength);
    digest.update(lengthPrefix);
    digest.update(part, "utf8");
  }

  return digest.digest();
}

export function createRateKeyDigester(
  masterSecret: Uint8Array,
): RateKeyDigester {
  if (masterSecret.byteLength < 32) {
    throw new RangeError("Rate-limit master key must contain at least 32 bytes");
  }
  const rateKey = deriveKey(masterSecret, RATE_HMAC_DOMAIN);
  return Object.freeze({
    digestRateKey(...parts: readonly string[]): Buffer {
      return digestTextPartsWithKey(rateKey, parts);
    },
  });
}

export function createDeleteConfirmationDigester(
  masterSecret: Uint8Array,
): DeleteConfirmationDigester {
  if (masterSecret.byteLength < 32) {
    throw new RangeError(
      "Delete-confirmation master key must contain at least 32 bytes",
    );
  }
  const deleteKey = deriveKey(masterSecret, DELETE_HMAC_DOMAIN);
  return Object.freeze({
    digestDeleteConfirmation(...parts: readonly string[]): Buffer {
      return digestTextPartsWithKey(deleteKey, parts);
    },
  });
}

const INVALID_DELETE_CONFIRMATION = Buffer.alloc(32);

export function encodeDeleteConfirmationToken(digest: Uint8Array): string {
  if (digest.byteLength !== 32) {
    throw new RangeError("Delete confirmation digest must contain exactly 32 bytes");
  }
  return Buffer.from(digest.buffer, digest.byteOffset, digest.byteLength)
    .toString("base64url");
}

function parseDeleteConfirmationToken(value: string | null | undefined): Buffer | null {
  if (value === null || value === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    return null;
  }
  const digest = Buffer.from(value, "base64url");
  return digest.length === 32 && digest.toString("base64url") === value
    ? digest
    : null;
}

export function verifyDeleteConfirmationToken(
  token: string | null | undefined,
  expectedDigest: Uint8Array,
): boolean {
  if (expectedDigest.byteLength !== 32) {
    throw new RangeError("Delete confirmation digest must contain exactly 32 bytes");
  }
  const candidate = parseDeleteConfirmationToken(token);
  const expected = Buffer.from(
    expectedDigest.buffer,
    expectedDigest.byteOffset,
    expectedDigest.byteLength,
  );
  const matches = timingSafeEqual(candidate ?? INVALID_DELETE_CONFIRMATION, expected);
  return candidate !== null && matches;
}

let guestMasterSecret: Buffer | undefined;
const domainKeys = new Map<HmacDomain, Buffer>();

function getGuestMasterSecret(): Buffer {
  guestMasterSecret ??= Buffer.from(getEnv().GUEST_TOKEN_SECRET, "base64url");
  return guestMasterSecret;
}

function getDomainKey(domain: HmacDomain): Buffer {
  let key = domainKeys.get(domain);
  if (key === undefined) {
    key = deriveKey(getGuestMasterSecret(), domain);
    domainKeys.set(domain, key);
  }
  return key;
}

export function deriveDomainKey(domain: HmacDomain): Buffer {
  return Buffer.from(getDomainKey(domain));
}

export function digestBinaryToken(
  domain: HmacDomain,
  token: Uint8Array,
): Buffer {
  return createHmac("sha256", getDomainKey(domain)).update(token).digest();
}

export function digestTextParts(
  domain: HmacDomain,
  ...parts: readonly string[]
): Buffer {
  return digestTextPartsWithKey(getDomainKey(domain), parts);
}
