import { redirect } from "next/navigation";

import { AppError } from "../features/appointments/http-errors";
import {
  extractManagerIdentity,
  readServerSession,
} from "./auth";
import type { ManagerIdentity } from "./auth-session";
import { safeReturnPath, signInPathFor } from "./return-path";

export async function requireOrganizer(
  requestedReturnPath: string,
): Promise<ManagerIdentity> {
  try {
    return extractManagerIdentity(await readServerSession());
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      redirect(signInPathFor(safeReturnPath(requestedReturnPath, "/dashboard")));
    }
    throw error;
  }
}
