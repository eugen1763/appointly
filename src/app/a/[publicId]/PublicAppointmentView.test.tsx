// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PublicAppointment } from "../../../features/appointments/server/snapshot";
import { installMemoryLocalStorage } from "./browser-storage-test-support";
import { formatCalendarDate } from "./calendar-date";
import { PublicAppointmentView, leadingOptionIds } from "./PublicAppointmentView";
import { TimedOptionLabel, formatTimedOption } from "./option-label";

const PARTICIPANT_A = "00000000-0000-4000-8000-000000000101";
const PARTICIPANT_B = "00000000-0000-4000-8000-000000000102";
const PARTICIPANT_C = "00000000-0000-4000-8000-000000000103";
const OPTION_A = "00000000-0000-4000-8000-000000000201";
const OPTION_B = "00000000-0000-4000-8000-000000000202";

const appointment: PublicAppointment = {
  appointment: {
    publicId: "abcdefghijklmnopqrstuvwx",
    title: "Release planning",
    description: "Choose the clearest day for the whole team.",
    type: "DATE",
    status: "FINALIZED",
    optionLimit: 5,
    finalOptionId: OPTION_B,
    revision: 8,
  },
  participants: [
    { id: PARTICIPANT_C, displayName: "First guest" },
    { id: PARTICIPANT_A, displayName: "Ada Guest" },
    { id: PARTICIPANT_B, displayName: "Zoë Long Participant Name" },
  ],
  options: [
    {
      id: OPTION_A,
      kind: "DATE",
      startDate: "2030-01-15",
      responses: [
        { participantId: PARTICIPANT_C, value: "YES" },
        { participantId: PARTICIPANT_A, value: "NO" },
      ],
    },
    {
      id: OPTION_B,
      kind: "DATE",
      startDate: "2030-01-16",
      responses: [
        { participantId: PARTICIPANT_A, value: "YES" },
        { participantId: PARTICIPANT_B, value: "NO" },
      ],
    },
  ],
};

/** OPTION_A at two Yes, OPTION_B at one: a real leader rather than a tie. */
const clearLeader: PublicAppointment = {
  ...appointment,
  appointment: {
    ...appointment.appointment,
    status: "ACTIVE",
    finalOptionId: null,
  },
  options: [
    {
      ...appointment.options[0],
      responses: [
        { participantId: PARTICIPANT_C, value: "YES" },
        { participantId: PARTICIPANT_B, value: "YES" },
      ],
    },
    appointment.options[1],
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  installMemoryLocalStorage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderView(value: PublicAppointment = appointment): void {
  act(() => root.render(<PublicAppointmentView appointment={value} />));
}

function markFor(optionId: string, participantId: string): string | null {
  return container.querySelector(
    `[data-option-id="${optionId}"][data-participant-id="${participantId}"] [role="img"]`,
  )?.getAttribute("aria-label") ?? null;
}

describe("PublicAppointmentView", () => {
  it("renders one board of option rows and participant columns in a stable order", () => {
    renderView();

    const scroller = container.querySelector("[data-board-scroll]");
    const table = scroller?.querySelector("table");
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(table).not.toBeNull();
    expect(table?.querySelector("caption")?.textContent).toBe(
      "Participant availability by appointment option",
    );
    expect(Array.from(
      table?.querySelectorAll("tbody th[data-option-id]") ?? [],
      (node) => node.getAttribute("data-option-id"),
    )).toEqual([OPTION_A, OPTION_B]);
    expect(Array.from(
      table?.querySelectorAll("tbody th[data-option-id]") ?? [],
      (node) => node.textContent,
    )).toEqual([
      formatCalendarDate("2030-01-15"),
      `CHOSEN${formatCalendarDate("2030-01-16")}`,
    ]);
    expect(Array.from(
      table?.querySelectorAll("thead [data-participant-id]") ?? [],
      (node) => node.textContent,
    )).toEqual([
      "FGFirst guest",
      "AGAda Guest",
      "ZLZoë Long Participant Name",
    ]);
    expect(Array.from(
      table?.querySelectorAll("thead [data-participant-id]") ?? [],
      (node) => node.getAttribute("data-participant-id"),
    )).toEqual([PARTICIPANT_C, PARTICIPANT_A, PARTICIPANT_B]);
  });
  it("offers the display-name join form on an active appointment", () => {
    renderView({
      ...appointment,
      appointment: {
        ...appointment.appointment,
        status: "ACTIVE",
        finalOptionId: null,
      },
    });

    expect(container.querySelector('form[aria-label="Join appointment"]')).not.toBeNull();
    expect(container.querySelector('input[name="displayName"]')).not.toBeNull();
  });


  it("names the participant and their answer on every mark in the option row", () => {
    renderView();

    expect(markFor(OPTION_A, PARTICIPANT_C)).toBe("First guest: Yes");
    expect(markFor(OPTION_A, PARTICIPANT_A)).toBe("Ada Guest: No");
    expect(markFor(OPTION_A, PARTICIPANT_B)).toBe("Zoë Long Participant Name: Unanswered");
    expect(markFor(OPTION_B, PARTICIPANT_A)).toBe("Ada Guest: Yes");
    expect(markFor(OPTION_B, PARTICIPANT_B)).toBe("Zoë Long Participant Name: No");
    const rowA = container.querySelector(`th[data-option-id="${OPTION_A}"]`)?.closest("tr");
    expect(rowA?.querySelector("td")?.textContent).toBe("1 yes · 1 no");
  });

  it("stamps the finalized choice on its own option rowheader", () => {
    renderView();

    const selected = container.querySelectorAll('[data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.tagName).toBe("TH");
    expect(selected[0]?.getAttribute("data-option-id")).toBe(OPTION_B);
    expect(selected[0]?.textContent).toContain("CHOSEN");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("finalized");
  });
  it("suppresses participant mutation controls on finalized appointments", () => {
    act(() => root.render(
      <PublicAppointmentView
        appointment={appointment}
        suggestionControls={<form aria-label="Suggest an option" />}
        renderOptionActions={(option) => (
          <button data-delete-option={option.id}>Delete</button>
        )}
      />,
    ));

    expect(container.querySelector('form[aria-label="Suggest an option"]')).toBeNull();
    expect(container.querySelector("[data-delete-option]")).toBeNull();
  });
});

describe("a board with no options", () => {
  const activeEmpty: PublicAppointment = {
    ...appointment,
    appointment: { ...appointment.appointment, status: "ACTIVE", finalOptionId: null },
    options: [],
  };
  const finalizedEmpty: PublicAppointment = {
    ...appointment,
    appointment: { ...appointment.appointment, finalOptionId: null },
    options: [],
  };

  const addControl = <form aria-label="Suggest an option" />;

  function suggestionForm(): Element | null {
    return container.querySelector('form[aria-label="Suggest an option"]');
  }

  /* Deleting every option used to strand the organizer: the add control lived
     inside the populated branch, so an emptied board could never be refilled. */
  it("invites the first option and still offers the add control", () => {
    act(() => root.render(
      <PublicAppointmentView appointment={activeEmpty} suggestionControls={addControl} />,
    ));

    expect(container.textContent).toContain("No options yet. Add the first one below.");
    expect(suggestionForm()).not.toBeNull();
  });

  it("states the read-only case when the viewer cannot suggest", () => {
    act(() => root.render(<PublicAppointmentView appointment={activeEmpty} />));

    expect(container.textContent).toContain("No options have been proposed yet.");
    expect(container.textContent).not.toContain("Add the first one below.");
    expect(suggestionForm()).toBeNull();
  });

  it("states the read-only case on a finalized appointment and hides the add control", () => {
    act(() => root.render(
      <PublicAppointmentView appointment={finalizedEmpty} suggestionControls={addControl} />,
    ));

    expect(container.textContent).toContain("No options have been proposed yet.");
    expect(container.textContent).not.toContain("Add the first one below.");
    expect(suggestionForm()).toBeNull();
  });
});

describe("leading options", () => {
  function counts(...yesCounts: readonly number[]) {
    return yesCounts.map((yesCount, index) => ({ id: `option-${index}`, yesCount }));
  }

  it("marks nothing on a fresh appointment, where every option is tied at one", () => {
    expect([...leadingOptionIds(counts(1, 1, 1, 1))]).toEqual([]);
  });

  it("marks nothing when nobody has said yes yet", () => {
    expect([...leadingOptionIds(counts(0, 0, 0))]).toEqual([]);
  });

  it("marks the single strictly highest option", () => {
    expect([...leadingOptionIds(counts(1, 3, 2))]).toEqual(["option-1"]);
  });

  it("marks joint leaders that stand above a lower option", () => {
    expect([...leadingOptionIds(counts(3, 3, 1))]).toEqual(["option-0", "option-1"]);
  });

  it("marks nothing when there is nothing to lead", () => {
    expect([...leadingOptionIds(counts(2))]).toEqual([]);
    expect([...leadingOptionIds([])]).toEqual([]);
  });

  it("marks the leader on an active board and nothing once it is finalized", () => {
    renderView(clearLeader);
    const marked = Array.from(
      container.querySelectorAll("tbody tr"),
      (row) => row.textContent?.includes("LEADING") ?? false,
    );
    expect(marked).toEqual([true, false]);

    renderView({
      ...clearLeader,
      appointment: {
        ...clearLeader.appointment,
        status: "FINALIZED",
        finalOptionId: OPTION_A,
      },
    });
    expect(container.textContent).not.toContain("LEADING");
  });

  it("marks nothing when every option carries only the creator's own yes", () => {
    renderView({
      ...appointment,
      appointment: {
        ...appointment.appointment,
        status: "ACTIVE",
        finalOptionId: null,
      },
      participants: [{ id: PARTICIPANT_C, displayName: "First guest" }],
      options: appointment.options.map((option) => ({
        ...option,
        responses: [{ participantId: PARTICIPANT_C, value: "YES" as const }],
      })),
    });

    expect(container.textContent).not.toContain("LEADING");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });
});

describe("option labels", () => {
  it("formats date-only values as calendar text without shifting in a western time zone", () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu";
    try {
      expect(formatCalendarDate("2030-01-01")).toBe("January 1, 2030");
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });

  it("formats timed values in the requested browser locale and IANA zone", () => {
    expect(formatTimedOption(
      { kind: "DATE_TIME", startAt: Date.UTC(2030, 0, 15, 12, 0) },
      "en-US",
      "America/New_York",
    )).toEqual({
      label: "Jan 15, 2030, 7:00 AM",
      timeZone: "America/New_York",
    });
  });

  it("defers the timed browser label until after mount and shows the resolved IANA zone", async () => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await act(async () => {
      root.render(
        <TimedOptionLabel option={{ kind: "DATE_TIME", startAt: Date.UTC(2030, 0, 15, 12, 0) }} />,
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-time-zone]")?.textContent).toBe(timeZone);
    expect(container.querySelector("time")?.textContent).not.toBe("");
  });
});
