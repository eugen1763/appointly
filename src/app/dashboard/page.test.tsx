import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardAppointment } from "../../features/appointments/server/management";

const {
  bindPendingManagersForDashboard,
  listDashboardAppointments,
  requireOrganizer,
} = vi.hoisted(() => ({
  bindPendingManagersForDashboard: vi.fn(),
  listDashboardAppointments: vi.fn(),
  requireOrganizer: vi.fn(),
}));

vi.mock("../../features/appointments/server/management", () => ({
  bindPendingManagersForDashboard,
  listDashboardAppointments,
}));
vi.mock("../../features/appointments/server/production-service-context", () => ({
  productionServiceContext: { db: "dashboard-test-db" },
}));
vi.mock("../../lib/organizer-access", () => ({ requireOrganizer }));
vi.mock("../../lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

import DashboardPage from "./page";

const ORGANIZER = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.com",
  name: "Owner Example",
};

const BASE: DashboardAppointment = {
  publicId: "abcdefghijklmnopqrstuvwx",
  title: "Planning",
  type: "DATE",
  status: "ACTIVE",
  updatedAt: 1_800_000_000_000,
  role: "OWNER",
  optionCount: 2,
  participantCount: 3,
  leadingOption: {
    option: { id: "option-1", kind: "DATE", startDate: "2030-02-01" },
    yesCount: 2,
    noCount: 1,
    tied: false,
  },
};

function card(overrides: Partial<DashboardAppointment> = {}): DashboardAppointment {
  return { ...BASE, ...overrides };
}

async function renderDashboard(
  appointments: readonly DashboardAppointment[],
): Promise<string> {
  listDashboardAppointments.mockReturnValueOnce({ appointments });
  return renderToStaticMarkup(await DashboardPage());
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganizer.mockResolvedValue(ORGANIZER);
});

describe("dashboard cards", () => {
  it("binds pending invitations before listing, against the production context", async () => {
    await renderDashboard([card()]);

    expect(requireOrganizer).toHaveBeenCalledWith("/dashboard");
    expect(bindPendingManagersForDashboard).toHaveBeenCalledWith(
      { db: "dashboard-test-db" },
      ORGANIZER,
    );
    expect(listDashboardAppointments).toHaveBeenCalledWith(
      { db: "dashboard-test-db" },
      { userId: ORGANIZER.userId },
    );
  });

  it("shows the option and participant tallies as metadata rows", async () => {
    const html = await renderDashboard([card()]);

    expect(html).toContain("<dt>Options</dt><dd>2</dd>");
    expect(html).toContain("<dt>Participants</dt><dd>3</dd>");
  });

  it("names the leading option with its formatted label and counts", async () => {
    const html = await renderDashboard([card()]);

    expect(html).toContain("Leading");
    expect(html).not.toContain("Leading (tied)");
    expect(html).toContain("February 1, 2030");
    expect(html).toContain("2 yes ·");
    expect(html).toContain("1 no");
  });

  it("marks joint leaders as tied", async () => {
    const html = await renderDashboard([card({
      leadingOption: { ...BASE.leadingOption!, tied: true },
    })]);

    expect(html).toContain("Leading (tied)");
  });

  it("leaves the leading line out when no option is ahead", async () => {
    const html = await renderDashboard([card({ leadingOption: null })]);

    expect(html).not.toContain("Leading");
    expect(html).not.toContain("February 1, 2030");
    expect(html).toContain("<dt>Options</dt><dd>2</dd>");
  });

  it("keeps the strict-mode text hooks unique inside a card", async () => {
    const html = await renderDashboard([card({ role: "COORGANIZER" })]);

    // The e2e dashboard assertions locate these by exact text within one card.
    expect(occurrences(html, ">Active<")).toBe(1);
    expect(occurrences(html, ">Day<")).toBe(1);
    expect(occurrences(html, ">Co-organizer<")).toBe(1);
    expect(occurrences(html, `>${BASE.title}</a>`)).toBe(1);
  });
});
