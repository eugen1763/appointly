import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface RuntimeEnv {
  readonly APP_URL: string;
  readonly appOrigin: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly GUEST_TOKEN_SECRET: string;
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly DATABASE_PATH: string;
  readonly TRUST_PROXY: boolean;
}
type EnvironmentName =
  | "APP_URL"
  | "BETTER_AUTH_SECRET"
  | "GUEST_TOKEN_SECRET"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "DATABASE_PATH"
  | "TRUST_PROXY";

function requireValue(
  source: NodeJS.ProcessEnv,
  name: EnvironmentName,
): string {
  const value = source[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function validateSecret(
  source: NodeJS.ProcessEnv,
  name: "BETTER_AUTH_SECRET" | "GUEST_TOKEN_SECRET",
): string {
  const value = requireValue(source, name);
  const remainder = value.length % 4;
  const lastValue = BASE64URL_ALPHABET.indexOf(value.at(-1) ?? "");
  const hasCanonicalTrailingBits =
    remainder === 0 ||
    (remainder === 2 && (lastValue & 0b1111) === 0) ||
    (remainder === 3 && (lastValue & 0b11) === 0);

  if (
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    remainder === 1 ||
    !hasCanonicalTrailingBits ||
    Math.floor((value.length * 3) / 4) < 32
  ) {
    throw new Error(
      `${name} must be unpadded base64url that decodes to at least 32 bytes`,
    );
  }

  return value;
}
function parseTrustProxy(source: NodeJS.ProcessEnv): boolean {
  const value = requireValue(source, "TRUST_PROXY");
  if (value !== "true" && value !== "false") {
    throw new Error("TRUST_PROXY must be exactly true or false");
  }
  return value === "true";
}
function validateDatabasePath(source: NodeJS.ProcessEnv): string {
  const value = requireValue(source, "DATABASE_PATH");
  const absolutePath = resolve(value);
  try {
    accessSync(dirname(absolutePath), constants.W_OK | constants.X_OK);
    if (existsSync(absolutePath)) {
      if (!statSync(absolutePath).isFile()) {
        throw new Error("not a file");
      }
      accessSync(absolutePath, constants.W_OK);
    }
  } catch {
    throw new Error("DATABASE_PATH must name a writable database file");
  }
  return value;
}




export function parseEnv(source: NodeJS.ProcessEnv): RuntimeEnv {
  const configuredAppUrl = requireValue(source, "APP_URL");

  let appUrl: URL;
  try {
    appUrl = new URL(configuredAppUrl);
  } catch {
    throw new Error("APP_URL must be a valid canonical HTTP origin");
  }

  if (
    (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") ||
    appUrl.username !== "" ||
    appUrl.password !== "" ||
    appUrl.pathname !== "/" ||
    appUrl.search !== "" ||
    appUrl.hash !== "" ||
    configuredAppUrl !== appUrl.origin
  ) {
    throw new Error("APP_URL must be a canonical HTTP origin");
  }

  return {
    APP_URL: appUrl.origin,
    appOrigin: appUrl.origin,
    BETTER_AUTH_SECRET: validateSecret(source, "BETTER_AUTH_SECRET"),
    GUEST_TOKEN_SECRET: validateSecret(source, "GUEST_TOKEN_SECRET"),
    GOOGLE_CLIENT_ID: requireValue(source, "GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: requireValue(source, "GOOGLE_CLIENT_SECRET"),
    DATABASE_PATH: validateDatabasePath(source),
    TRUST_PROXY: parseTrustProxy(source),
  };
}
let cachedEnv: RuntimeEnv | undefined;


export function getEnv(): RuntimeEnv {
  cachedEnv ??= Object.freeze(parseEnv(process.env));
  return cachedEnv;
}
