import {
  createGuestSessionTimestamps,
  parseGuestSessionToken,
} from "./guest-session";

export { createGuestSessionTimestamps };

export const GUEST_SESSION_COOKIE_NAME = "appointly_guest_session";
export const GUEST_SESSION_COOKIE_MAX_AGE_SECONDS = 31_536_000;

export function readGuestSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader === null) return null;
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    const name = cookie.slice(0, separator).trim();
    if (name === GUEST_SESSION_COOKIE_NAME) {
      return cookie.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

export function serializeGuestSessionCookie(
  token: string,
  appOrigin: string,
): string {
  if (parseGuestSessionToken(token) === null) {
    throw new RangeError("Guest session cookie token must be canonical base64url");
  }
  const secure = new URL(appOrigin).protocol === "https:" ? "; Secure" : "";
  return `${GUEST_SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${GUEST_SESSION_COOKIE_MAX_AGE_SECONDS}; HttpOnly${secure}; SameSite=Lax`;
}


