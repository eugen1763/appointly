import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AppError } from "../../../features/appointments/http-errors";
import { GUEST_SESSION_COOKIE_NAME } from "../../../features/appointments/server/guest-session-storage";
import { productionGuestTokenDigester } from "../../../features/appointments/server/production-guest-token-digester";
import { productionServiceContext } from "../../../features/appointments/server/production-service-context";
import { getAppointmentSnapshot } from "../../../features/appointments/server/snapshot";
import { readServerSession } from "../../../lib/auth";
import { AppointmentClient } from "./AppointmentClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

interface PublicAppointmentPageProps {
  readonly params: Promise<{ readonly publicId: string }>;
}

export default async function PublicAppointmentPage({ params }: PublicAppointmentPageProps) {
  const { publicId } = await params;
  const [cookieStore, session] = await Promise.all([
    cookies(),
    readServerSession(),
  ]);
  try {
    const snapshot = getAppointmentSnapshot(productionServiceContext, {
      publicId,
      identity: session === null ? null : {
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
      requestedParticipantId: null,
      guestSessionToken: cookieStore.get(GUEST_SESSION_COOKIE_NAME)?.value ?? null,
    }, productionGuestTokenDigester);
    return <AppointmentClient initialSnapshot={snapshot} />;
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
