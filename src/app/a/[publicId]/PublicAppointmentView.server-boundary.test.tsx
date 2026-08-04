import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type { PublicAppointment } from "../../../features/appointments/server/snapshot";

vi.mock("./option-label", () => ({
  TimedOptionLabel: () => null,
  formatCalendarDate: () => {
    throw new Error("Server view invoked an export from a client module");
  },
}));

import { PublicAppointmentView } from "./PublicAppointmentView";

const appointment: PublicAppointment = {
  appointment: {
    publicId: "abcdefghijklmnopqrstuvwx",
    title: "Calendar-only planning",
    description: null,
    type: "DATE",
    status: "ACTIVE",
    optionLimit: 3,
    finalOptionId: null,
    revision: 1,
  },
  participants: [],
  options: [{
    id: "00000000-0000-4000-8000-000000000201",
    kind: "DATE",
    startDate: "2030-01-01",
    responses: [],
  }],
};

it("renders calendar dates without invoking an export from the client formatter module", () => {
  expect(() => renderToStaticMarkup(
    <PublicAppointmentView appointment={appointment} />,
  )).not.toThrow();
});
