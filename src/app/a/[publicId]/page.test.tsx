import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppointmentSnapshot } from "../../../features/appointments/contracts";
import { AppError } from "../../../features/appointments/http-errors";

const {
  cookies,
  getAppointmentSnapshot,
  notFound,
  readServerSession,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  getAppointmentSnapshot: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  readServerSession: vi.fn(),
}));

vi.mock("../../../features/appointments/server/snapshot", () => ({
  getAppointmentSnapshot,
}));
vi.mock("../../../features/appointments/server/production-guest-token-digester", () => ({
  productionGuestTokenDigester: { kind: "test-token-digester" },
}));
vi.mock("../../../features/appointments/server/production-service-context", () => ({
  productionServiceContext: { db: "public-test-db" },
}));
vi.mock("../../../lib/auth", () => ({ readServerSession }));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("next/navigation", () => ({
  notFound,
  useRouter: () => ({ replace: vi.fn() }),
}));

import PublicAppointmentPage, { metadata } from "./page";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000123";
const fixture: AppointmentSnapshot = {
  appointment: {
    publicId: PUBLIC_ID,
    title: "Public planning",
    description: null,
    type: "DATE",
    status: "ACTIVE",
    optionLimit: 3,
    finalOptionId: null,
    revision: 1,
  },
  participants: [{ id: PARTICIPANT_ID, displayName: "Avery Guest" }],
  options: [],
  viewer: {
    kind: "guest",
    activeParticipantId: PARTICIPANT_ID,
    accessibleParticipants: [{ id: PARTICIPANT_ID, displayName: "Avery Guest" }],
    needsParticipantName: false,
    participantEnrollmentError: null,
    permissions: {
      canEditAppointment: false,
      canManageCoOrganizers: false,
      canDeleteAppointment: false,
      canFinalize: false,
      canReopen: false,
      canResetGuestLinks: false,
      canRespond: true,
      canSuggest: true,
    },
  },
};

const RAW_SESSION_TOKEN = Buffer.alloc(32, 0x45).toString("base64url");

beforeEach(() => {
  vi.clearAllMocks();
  readServerSession.mockResolvedValue(null);
  cookies.mockResolvedValue({
    get: vi.fn((name: string) => name === "appointly_guest_session"
      ? { value: RAW_SESSION_TOKEN }
      : undefined),
  });
});

describe("public appointment route", () => {
  it("exports noindex and nofollow metadata", () => {
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false },
    });
  });

  it("loads one private-data-free initial snapshot with session and guest access", async () => {
    getAppointmentSnapshot.mockReturnValueOnce(fixture);
    readServerSession.mockResolvedValueOnce({
      user: { id: "user-1", email: "user@example.com", name: "User" },
    });

    const element = await PublicAppointmentPage({ params: Promise.resolve({ publicId: PUBLIC_ID }) });
    const html = renderToStaticMarkup(element);

    expect(getAppointmentSnapshot).toHaveBeenCalledWith(
      { db: "public-test-db" },
      {
        publicId: PUBLIC_ID,
        identity: { userId: "user-1", email: "user@example.com", name: "User" },
        requestedParticipantId: null,
        guestSessionToken: RAW_SESSION_TOKEN,
      },
      { kind: "test-token-digester" },
    );
    const serializedClientBoundary = JSON.stringify(element);
    expect(serializedClientBoundary).not.toContain(RAW_SESSION_TOKEN);
    expect(serializedClientBoundary).not.toContain("test-token-digester");
    expect(html).not.toContain(RAW_SESSION_TOKEN);
    expect(html).not.toContain("test-token-digester");
    expect(html).toContain("Public planning");
    expect(html).toContain("Response editing");
    expect(html).toContain("Returning as");
    expect(html).toContain("Avery Guest");
  });

  it("uses the app not-found experience for an unknown public ID", async () => {
    getAppointmentSnapshot.mockImplementationOnce(() => {
      throw new AppError("NOT_FOUND", "Appointment was not found.");
    });

    await expect(PublicAppointmentPage({
      params: Promise.resolve({ publicId: "zyxwvutsrqponmlkjihgfedc" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
