import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getEnv, parseEnv } from "./env";
import {
  DELETE_HMAC_DOMAIN,
  EDIT_HMAC_DOMAIN,
  RATE_HMAC_DOMAIN,
  SESSION_HMAC_DOMAIN,
  deriveDomainKey,
  digestBinaryToken,
  digestTextParts,
} from "./security";

const VALID_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const LONG_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g";

let taskDirectory: string;

function validSource(directory = taskDirectory): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    APP_URL: "https://appointments.example",
    BETTER_AUTH_SECRET: VALID_SECRET,
    GUEST_TOKEN_SECRET: VALID_SECRET,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    DATABASE_PATH: join(directory, "appointly.sqlite"),
    TRUST_PROXY: "false",
  };
}

beforeEach(() => {
  taskDirectory = mkdtempSync(join(tmpdir(), "appointly-task-3-"));
});

afterEach(() => {
  chmodSync(taskDirectory, 0o700);
  rmSync(taskDirectory, { recursive: true, force: true });
});

describe("APP_URL", () => {
  it("returns the configured canonical HTTP origin", () => {
    const result = parseEnv(validSource());

    expect(result.APP_URL).toBe("https://appointments.example");
    expect(result.appOrigin).toBe("https://appointments.example");
  });

  it.each([
    ["credentials", "https://user:password@appointments.example"],
    ["a non-root path", "https://appointments.example/a"],
    ["a query", "https://appointments.example?mode=test"],
    ["a fragment", "https://appointments.example#share"],
    ["a trailing slash", "https://appointments.example/"],
    ["normalized host casing", "https://APPOINTMENTS.example"],
    ["a normalized default port", "https://appointments.example:443"],
    ["a non-HTTP scheme", "ftp://appointments.example"],
  ])("rejects %s", (_caseName, appUrl) => {
    expect(() => parseEnv({ ...validSource(), APP_URL: appUrl })).toThrow(/APP_URL/);
  });

  it("rejects an invalid URL", () => {
    expect(() => parseEnv({ ...validSource(), APP_URL: "not a URL" })).toThrow(/APP_URL/);
  });
});

describe("required environment values", () => {
  it.each([
    "APP_URL",
    "BETTER_AUTH_SECRET",
    "GUEST_TOKEN_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "DATABASE_PATH",
    "TRUST_PROXY",
  ] as const)("rejects an absent %s", (name) => {
    const source = validSource();
    delete source[name];

    expect(() => parseEnv(source)).toThrow(new RegExp(name));
  });

  it.each(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const)(
    "rejects a blank %s",
    (name) => {
      expect(() => parseEnv({ ...validSource(), [name]: "   " })).toThrow(
        new RegExp(name),
      );
    },
  );
});

describe("base64url secrets", () => {
  it.each(["BETTER_AUTH_SECRET", "GUEST_TOKEN_SECRET"] as const)(
    "accepts an unpadded %s that decodes to 32 bytes",
    (name) => {
      expect(parseEnv({ ...validSource(), [name]: VALID_SECRET })[name]).toBe(
        VALID_SECRET,
      );
    },
  );

  it.each(["BETTER_AUTH_SECRET", "GUEST_TOKEN_SECRET"] as const)(
    "accepts an unpadded %s that decodes to more than 32 bytes",
    (name) => {
      expect(parseEnv({ ...validSource(), [name]: LONG_SECRET })[name]).toBe(
        LONG_SECRET,
      );
    },
  );

  it.each(["BETTER_AUTH_SECRET", "GUEST_TOKEN_SECRET"] as const)(
    "rejects padding in %s",
    (name) => {
      expect(() => parseEnv({ ...validSource(), [name]: `${VALID_SECRET}=` })).toThrow(
        new RegExp(name),
      );
    },
  );

  it.each(["BETTER_AUTH_SECRET", "GUEST_TOKEN_SECRET"] as const)(
    "rejects non-base64url characters in %s",
    (name) => {
      expect(() => parseEnv({ ...validSource(), [name]: `${VALID_SECRET.slice(0, -1)}+` })).toThrow(
        new RegExp(name),
      );
    },
  );

  it.each(["BETTER_AUTH_SECRET", "GUEST_TOKEN_SECRET"] as const)(
    "rejects a %s that decodes to fewer than 32 bytes",
    (name) => {
      expect(() => parseEnv({ ...validSource(), [name]: "c2hvcnQ" })).toThrow(
        new RegExp(name),
      );
    },
  );

  it.each(["BETTER_AUTH_SECRET", "GUEST_TOKEN_SECRET"] as const)(
    "rejects an impossible unpadded length for %s",
    (name) => {
      expect(() => parseEnv({ ...validSource(), [name]: "A".repeat(41) })).toThrow(
        new RegExp(name),
      );
    },
  );

  it.each(["BETTER_AUTH_SECRET", "GUEST_TOKEN_SECRET"] as const)(
    "rejects noncanonical trailing bits in %s",
    (name) => {
      const noncanonical = `${VALID_SECRET.slice(0, -1)}9`;
      expect(() => parseEnv({ ...validSource(), [name]: noncanonical })).toThrow(
        new RegExp(name),
      );
    },
  );
});

describe("TRUST_PROXY", () => {
  it.each([
    ["true", true],
    ["false", false],
  ] as const)("parses exact %s", (configured, expected) => {
    expect(parseEnv({ ...validSource(), TRUST_PROXY: configured }).TRUST_PROXY).toBe(
      expected,
    );
  });

  it.each(["TRUE", "False", "1", "0", "yes", "", " false "])(
    "rejects %j",
    (configured) => {
      expect(() => parseEnv({ ...validSource(), TRUST_PROXY: configured })).toThrow(
        /TRUST_PROXY/,
      );
    },
  );
});

describe("DATABASE_PATH", () => {
  it("accepts a file in a writable parent without creating the file", () => {
    const databasePath = join(taskDirectory, "appointly.sqlite");

    expect(parseEnv({ ...validSource(), DATABASE_PATH: databasePath }).DATABASE_PATH).toBe(
      databasePath,
    );
    expect(existsSync(databasePath)).toBe(false);
    expect(() => accessSync(taskDirectory, constants.W_OK)).not.toThrow();
  });

  it("rejects a path whose parent does not exist", () => {
    const databasePath = join(taskDirectory, "missing", "appointly.sqlite");

    expect(() => parseEnv({ ...validSource(), DATABASE_PATH: databasePath })).toThrow(
      /DATABASE_PATH/,
    );
    expect(existsSync(join(taskDirectory, "missing"))).toBe(false);
  });

  it("rejects a path whose parent is not writable", () => {
    const readOnlyParent = join(taskDirectory, "read-only");
    mkdirSync(readOnlyParent, 0o500);
    const databasePath = join(readOnlyParent, "appointly.sqlite");
    let writeDenied = false;
    try {
      accessSync(readOnlyParent, constants.W_OK);
    } catch {
      writeDenied = true;
    }
    if (!writeDenied) return;


    try {
      expect(() => parseEnv({ ...validSource(), DATABASE_PATH: databasePath })).toThrow(
        /DATABASE_PATH/,
      );
      expect(existsSync(databasePath)).toBe(false);
    } finally {
      chmodSync(readOnlyParent, 0o700);
    }
  });
  it("rejects a writable parent that cannot search child paths", () => {
    const unsearchableParent = join(taskDirectory, "unsearchable");
    mkdirSync(unsearchableParent, 0o200);
    const databasePath = join(unsearchableParent, "appointly.sqlite");
    let childAccessDenied = false;

    try {
      accessSync(unsearchableParent, constants.W_OK | constants.X_OK);
    } catch {
      childAccessDenied = true;
    }

    try {
      if (!childAccessDenied) return;
      expect(() => parseEnv({ ...validSource(), DATABASE_PATH: databasePath })).toThrow(
        /DATABASE_PATH/,
      );
    } finally {
      chmodSync(unsearchableParent, 0o700);
    }
  });


  it("rejects an existing database file that is not writable", () => {
    const databasePath = join(taskDirectory, "appointly.sqlite");
    writeFileSync(databasePath, "");
    chmodSync(databasePath, 0o400);
    let writeDenied = false;
    try {
      accessSync(databasePath, constants.W_OK);
    } catch {
      writeDenied = true;
    }
    if (!writeDenied) {
      chmodSync(databasePath, 0o600);
      return;
    }


    try {
      expect(() => parseEnv({ ...validSource(), DATABASE_PATH: databasePath })).toThrow(
        /DATABASE_PATH/,
      );
    } finally {
      chmodSync(databasePath, 0o600);
    }
  });

  it("rejects a directory as the database path", () => {
    expect(() =>
      parseEnv({ ...validSource(), DATABASE_PATH: taskDirectory }),
    ).toThrow(/DATABASE_PATH/);
  });
});

describe("HMAC security", () => {
  const managedNames = [
    "APP_URL",
    "BETTER_AUTH_SECRET",
    "GUEST_TOKEN_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "DATABASE_PATH",
    "TRUST_PROXY",
  ] as const;
  const originalValues: Partial<Record<(typeof managedNames)[number], string>> = {};
  let securityDirectory: string;

  beforeAll(() => {
    securityDirectory = mkdtempSync(join(tmpdir(), "appointly-task-3-security-"));
    for (const name of managedNames) {
      const value = process.env[name];
      if (value !== undefined) originalValues[name] = value;
    }
    Object.assign(process.env, validSource(securityDirectory));
  });

  afterAll(() => {
    for (const name of managedNames) {
      const original = originalValues[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    rmSync(securityDirectory, { recursive: true, force: true });
  });

  it("caches one validated runtime environment", () => {
    expect(getEnv()).toBe(getEnv());
    expect(getEnv().appOrigin).toBe("https://appointments.example");
  });
  it("freezes the cached environment before exposing its secrets", () => {
    expect(Object.isFrozen(getEnv())).toBe(true);
    expect(() => {
      Object.assign(getEnv(), { GUEST_TOKEN_SECRET: "AA" });
    }).toThrow(TypeError);
  });


  it("derives keys from all four exact domain prefixes", () => {
    expect(EDIT_HMAC_DOMAIN).toBe("appointly/edit/v1");
    expect(SESSION_HMAC_DOMAIN).toBe("appointly/session/v1");
    expect(RATE_HMAC_DOMAIN).toBe("appointly/rate/v1");
    expect(DELETE_HMAC_DOMAIN).toBe("appointly/delete/v1");

    expect(deriveDomainKey(EDIT_HMAC_DOMAIN).toString("hex")).toBe(
      "17f33f18956ea3477b4c77964b254f4596293f0563813a5498e7104e814aaaa0",
    );
    expect(deriveDomainKey(SESSION_HMAC_DOMAIN).toString("hex")).toBe(
      "044599ce84aa2a493e8a1238e56d1ca4a503da45bb7f8415a94b7ae04211e35a",
    );
    expect(deriveDomainKey(RATE_HMAC_DOMAIN).toString("hex")).toBe(
      "1a778e92fae3e68b1ad27a040f458cca7d3b4cc359abc8ba63cc25ee838437f6",
    );
    expect(deriveDomainKey(DELETE_HMAC_DOMAIN).toString("hex")).toBe(
      "70abf9001346a3b3c7e3a4240a4ec6c480563a9318f60ea42dadfcf1c26251d5",
    );
  });

  it("digests a binary token with its domain key", () => {
    expect(
      digestBinaryToken(EDIT_HMAC_DOMAIN, Buffer.from(Array.from({ length: 32 }, (_, i) => i + 32))).toString(
        "hex",
      ),
    ).toBe("0e97ac0e2526cd69893e82f59b0339f7b9f540bfa5c691a5c594f1d201d8b737");
  });

  it("prefixes each variable text part so concatenations cannot collide", () => {
    expect(digestTextParts(RATE_HMAC_DOMAIN, "ab", "c").toString("hex")).toBe(
      "f76927b53d487c6fec0157baa0c0debdb07d6abe210dbb2503240a96b633fc7c",
    );
    expect(digestTextParts(RATE_HMAC_DOMAIN, "a", "bc").toString("hex")).toBe(
      "3ef4a4accf1018cc8c58a5acab388cdeb8fc63aeb177dac6ac712d1e80ad842b",
    );
  });

  it("uses UTF-8 byte length in each big-endian uint32 prefix", () => {
    expect(digestTextParts(RATE_HMAC_DOMAIN, "é", "guest").toString("hex")).toBe(
      "f8b5766a178ee6b75dc59285642e77ccfb9fb8ac06c819f59318d0b57531d1ba",
    );
  });
});
