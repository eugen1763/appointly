import { AppError } from "../features/appointments/http-errors";

export interface ManagerIdentity {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export interface ManagerSession {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  };
}

export function extractManagerIdentity(
  session: ManagerSession | null,
): ManagerIdentity {
  const email = session?.user.email.trim();
  if (!session || !email) {
    throw new AppError("UNAUTHENTICATED", "Sign in with Google to continue.");
  }

  return {
    userId: session.user.id,
    email,
    name: session.user.name,
  };
}
