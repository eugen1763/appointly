const APP_LOCAL_BASE = "https://app.appointly.invalid";

export function safeReturnPath(
  value: unknown,
  fallback: string,
): string {
  if (
    typeof value !== "string"
    || value === ""
    || value !== value.trim()
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, APP_LOCAL_BASE);
    if (parsed.origin !== APP_LOCAL_BASE) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function signInPathFor(returnTo: string): string {
  return `/sign-in?${new URLSearchParams({ returnTo }).toString()}`;
}
