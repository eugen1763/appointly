import { z } from "zod";

const emailAddress = z.email();
const asciiOuterWhitespace = /^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/g;

export function normalizeEmail(input: string): string {
  const trimmed = input.replace(asciiOuterWhitespace, "");
  const email = emailAddress.parse(trimmed);
  const separator = email.lastIndexOf("@");

  return `${email.slice(0, separator).toLowerCase()}@${email
    .slice(separator + 1)
    .toLowerCase()}`;
}
