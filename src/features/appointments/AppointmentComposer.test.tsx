// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppointmentComposer } from "./AppointmentComposer";
import type { CreateAppointmentSuccess } from "./contracts";
import {
  CreateAppointmentRequestError,
  type CreateAppointmentSubmit,
} from "./create-appointment-client";
import { cleanup, fireEvent, render, screen, userEvent } from "./react-dom-test-support";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const success: CreateAppointmentSuccess = {
  publicId: "abcdefghijklmnopqrstuvwx",
  publicUrl: "https://appointly.test/a/abcdefghijklmnopqrstuvwx",
  revision: 1,
};

/** Fixed clock: today is April 15 2030, so April 16 onwards is pickable. */
const now = () => new Date("2030-04-15T12:00:00");
const DAY_ONE = "2030-04-16";
const DAY_TWO = "2030-04-17";
const DAY_APART = "2030-04-20";
const LABEL_ONE = "April 16, 2030";
const LABEL_TWO = "April 17, 2030";

type User = ReturnType<typeof userEvent.setup>;

interface RenderComposerOptions {
  submit?: CreateAppointmentSubmit;
  copyText?: (text: string) => Promise<void>;
  defaultOwnerDisplayName?: string;
}

function renderComposer(options: RenderComposerOptions = {}) {
  const submit = options.submit ?? vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success);
  const copyText = options.copyText ?? vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const user = userEvent.setup();

  render(
    <AppointmentComposer
      defaultOwnerDisplayName={options.defaultOwnerDisplayName ?? "Ada Lovelace"}
      submit={submit}
      copyText={copyText}
      now={now}
    />,
  );

  return { user, submit, copyText };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function dayButton(isoDate: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-date="${isoDate}"]`);
  if (!button) throw new Error(`Day ${isoDate} was not rendered`);
  return button;
}

function badge(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-inferred-type]");
  if (!element) throw new Error("The inferred type badge was not rendered");
  return element;
}

function alertText(id: string): string | undefined {
  return document.getElementById(id)?.textContent ?? undefined;
}

function change(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function pick(...isoDates: readonly string[]): void {
  for (const isoDate of isoDates) fireEvent.click(dayButton(isoDate));
}

/** The checkbox reads event.target.checked, so it must be clicked, not "changed". */
function toggleCombine(): void {
  fireEvent.click(screen.getByLabelText("Combine into one date range"));
}

function stepMonths(count: number): void {
  const step = screen.getByRole("button", { name: "Next month" });
  for (let pressed = 0; pressed < count; pressed += 1) fireEvent.click(step);
}

async function fillTitle(user: User, value = "Planning review"): Promise<void> {
  await user.type(screen.getByLabelText("Title"), value);
}

async function openAdvanced(user: User): Promise<void> {
  await user.click(screen.getByRole("button", { name: "More settings" }));
}

async function commit(user: User): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Create and copy link" }));
  await settle();
}

beforeEach(() => {
  process.env.TZ = "America/New_York";
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppointmentComposer shell", () => {
  it("focuses the title, opens on the current month, and blocks past days", () => {
    renderComposer();

    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
    expect(screen.getByLabelText("Title").getAttribute("maxlength")).toBe("120");
    expect(document.querySelector("[data-cal-month]")?.textContent).toBe("April 2030");
    expect(dayButton("2030-04-14").disabled).toBe(true);
    expect(dayButton("2030-04-15").disabled).toBe(false);
    expect(dayButton(DAY_ONE).disabled).toBe(false);
    expect(screen.getByText("Click the days that could work.")).not.toBeNull();
  });

  it("re-reads the calendar day from the client clock after mount", () => {
    const clocks = [
      new Date("2030-04-15T23:59:00"),
      new Date("2030-04-15T23:59:00"),
      new Date("2030-04-16T00:01:00"),
    ];
    let call = 0;
    render(
      <AppointmentComposer
        defaultOwnerDisplayName="Ada Lovelace"
        submit={vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success)}
        copyText={vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)}
        now={() => clocks[Math.min(call++, clocks.length - 1)]}
      />,
    );

    expect(dayButton("2030-04-16").getAttribute("data-today")).toBe("1");
    expect(dayButton("2030-04-15").getAttribute("data-today")).toBeNull();
    expect(dayButton("2030-04-15").disabled).toBe(true);
  });

  it("keeps the advanced settings closed until More settings is pressed", async () => {
    const { user } = renderComposer();
    const toggle = screen.getByRole("button", { name: "More settings" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("composer-advanced");
    expect(screen.queryByLabelText("Option limit")).toBeNull();

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "More settings" }).getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByLabelText("Option limit") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Owner display name") as HTMLInputElement).value).toBe("Ada Lovelace");
    expect(screen.getByLabelText("Description (optional)").getAttribute("maxlength")).toBe("2000");
  });
});

describe("AppointmentComposer type inference", () => {
  it("reads no days and whole days as DATE", () => {
    renderComposer();

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE");
    expect(badge().textContent).toBe("Whole days");

    pick(DAY_ONE);

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE");
    expect(badge().textContent).toBe("Whole days");
  });

  it("keeps two consecutive days as separate DATE options and offers the opt-in", () => {
    renderComposer();

    pick(DAY_ONE, DAY_TWO);

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE");
    expect(badge().textContent).toBe("Whole days");
    expect((screen.getByLabelText("Combine into one date range") as HTMLInputElement).checked).toBe(false);
  });

  it("never offers the opt-in for days that are not consecutive", () => {
    renderComposer();

    pick(DAY_ONE, DAY_APART);

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE");
    expect(screen.queryByLabelText("Combine into one date range")).toBeNull();
  });

  it("turns a checked run into DATE_RANGE and adds times as DATE_TIME_RANGE", () => {
    renderComposer();

    pick(DAY_ONE, DAY_TWO);
    toggleCombine();

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE_RANGE");
    expect(badge().textContent).toBe("One run of days");

    change("Start time", "09:30");

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE_TIME_RANGE");
    expect(badge().textContent).toBe("A run, with times");
  });

  it("unchecks the opt-in as soon as the picked set stops being a run", () => {
    renderComposer();

    pick(DAY_ONE, DAY_TWO);
    toggleCombine();
    expect(badge().getAttribute("data-inferred-type")).toBe("DATE_RANGE");

    pick(DAY_APART);

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE");
    expect(screen.queryByLabelText("Combine into one date range")).toBeNull();

    pick(DAY_APART);

    expect((screen.getByLabelText("Combine into one date range") as HTMLInputElement).checked).toBe(false);
    expect(badge().getAttribute("data-inferred-type")).toBe("DATE");
  });

  it("reads a start time as DATE_TIME and a start plus end as DATE_TIME_RANGE", () => {
    renderComposer();

    pick(DAY_ONE);
    expect((screen.getByLabelText("End time") as HTMLInputElement).disabled).toBe(true);

    change("Start time", "09:30");

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE_TIME");
    expect(badge().textContent).toBe("Days at a time");
    expect((screen.getByLabelText("End time") as HTMLInputElement).disabled).toBe(false);

    change("End time", "10:45");

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE_TIME_RANGE");
    expect(badge().textContent).toBe("Days with a start and end");
  });

  it("names the two DATE_TIME_RANGE shapes differently under one inferred type", () => {
    renderComposer();

    pick(DAY_ONE, DAY_TWO);
    change("Start time", "09:30");
    change("End time", "10:45");

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE_TIME_RANGE");
    expect(badge().textContent).toBe("Days with a start and end");

    toggleCombine();

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE_TIME_RANGE");
    expect(badge().textContent).toBe("A run, with times");
  });

  it("clears the end time and every per-day override when the start time is cleared", () => {
    renderComposer();

    pick(DAY_ONE, DAY_TWO);
    change("Start time", "09:00");
    change("End time", "10:00");
    change(`Start time for ${LABEL_TWO}`, "14:00");
    expect((screen.getByLabelText(`Start time for ${LABEL_TWO}`) as HTMLInputElement).value).toBe("14:00");

    change("Start time", "");

    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("End time") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText(`Start time for ${LABEL_TWO}`)).toBeNull();
    expect(badge().getAttribute("data-inferred-type")).toBe("DATE");

    change("Start time", "09:00");
    expect((screen.getByLabelText(`Start time for ${LABEL_TWO}`) as HTMLInputElement).value).toBe("09:00");
  });

  it("lists each picked day as a chip with its time suffix", () => {
    renderComposer();

    pick(DAY_TWO, DAY_ONE);
    const chips = screen.getByRole("list", { name: "Selected days" });
    expect(chips.children).toHaveLength(2);
    expect(chips.children[0].textContent).toContain(LABEL_ONE);
    expect(chips.children[1].textContent).toContain(LABEL_TWO);

    change("Start time", "09:00");
    expect(chips.children[0].textContent).toContain(`${LABEL_ONE} · 09:00`);

    change("End time", "10:00");
    expect(chips.children[0].textContent).toContain(`${LABEL_ONE} · 09:00–10:00`);

    toggleCombine();

    expect(chips.children[0].textContent).toContain(LABEL_ONE);
    expect(chips.children[0].textContent).not.toContain("09:00–10:00");
  });

  it("un-presses the calendar day when its chip is removed", async () => {
    const { user } = renderComposer();

    pick(DAY_ONE);
    expect(dayButton(DAY_ONE).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: `Remove ${LABEL_ONE}` }));

    expect(dayButton(DAY_ONE).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("list", { name: "Selected days" })).toBeNull();
  });
});

describe("AppointmentComposer per-day times", () => {
  it("submits an overridden day at its own time while the type stays DATE_TIME", async () => {
    const submit = vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success);
    const { user } = renderComposer({ submit });

    await fillTitle(user);
    pick(DAY_ONE, DAY_TWO);
    change("Start time", "09:00");
    change(`Start time for ${LABEL_TWO}`, "14:00");

    expect(badge().getAttribute("data-inferred-type")).toBe("DATE_TIME");
    await commit(user);

    expect(submit).toHaveBeenCalledWith({
      title: "Planning review",
      description: null,
      ownerDisplayName: "Ada Lovelace",
      type: "DATE_TIME",
      optionLimit: 10,
      coOrganizerEmails: [],
      timeZone: "America/New_York",
      options: [
        { kind: "DATE_TIME", startAt: "2030-04-16T13:00:00.000Z" },
        { kind: "DATE_TIME", startAt: "2030-04-17T18:00:00.000Z" },
      ],
    });
  });

  it("re-applies a changed shared time only to days that were not overridden", () => {
    renderComposer();

    pick(DAY_ONE, DAY_TWO);
    change("Start time", "09:00");
    change(`Start time for ${LABEL_TWO}`, "14:00");

    change("Start time", "11:00");

    expect((screen.getByLabelText(`Start time for ${LABEL_ONE}`) as HTMLInputElement).value).toBe("11:00");
    expect((screen.getByLabelText(`Start time for ${LABEL_TWO}`) as HTMLInputElement).value).toBe("14:00");
    const chips = screen.getByRole("list", { name: "Selected days" });
    expect(chips.children[1].getAttribute("data-edited")).toBe("true");
    expect(chips.children[0].getAttribute("data-edited")).toBeNull();
  });

  it("hides the per-day controls while the run is combined into one range", () => {
    renderComposer();

    pick(DAY_ONE, DAY_TWO);
    change("Start time", "09:00");
    expect(screen.getByLabelText(`Start time for ${LABEL_ONE}`)).not.toBeNull();

    toggleCombine();

    expect(screen.queryByLabelText(`Start time for ${LABEL_ONE}`)).toBeNull();
    expect(screen.queryByLabelText(`Start time for ${LABEL_TWO}`)).toBeNull();
  });
});

describe("AppointmentComposer payloads", () => {
  it("submits the exact eight-key input for whole days", async () => {
    const submit = vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success);
    const { user } = renderComposer({ submit });

    await fillTitle(user, "Quarterly planning");
    await openAdvanced(user);
    await user.type(screen.getByLabelText("Description (optional)"), "Pick one day.");
    const limit = screen.getByLabelText("Option limit");
    await user.clear(limit);
    await user.type(limit, "3");
    await user.type(screen.getByLabelText("Co-organizer email"), "grace@example.com");
    await user.click(screen.getByRole("button", { name: "Add co-organizer" }));
    pick(DAY_ONE);
    await commit(user);

    expect(submit).toHaveBeenCalledWith({
      title: "Quarterly planning",
      description: "Pick one day.",
      ownerDisplayName: "Ada Lovelace",
      type: "DATE",
      optionLimit: 3,
      coOrganizerEmails: ["grace@example.com"],
      timeZone: "America/New_York",
      options: [{ kind: "DATE", startDate: DAY_ONE }],
    });
  });

  it("submits one browser-local timed instant as exact canonical UTC", async () => {
    const submit = vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success);
    const { user } = renderComposer({ submit });

    await fillTitle(user);
    pick(DAY_ONE);
    change("Start time", "09:30");
    await commit(user);

    expect(submit).toHaveBeenCalledWith({
      title: "Planning review",
      description: null,
      ownerDisplayName: "Ada Lovelace",
      type: "DATE_TIME",
      optionLimit: 10,
      coOrganizerEmails: [],
      timeZone: "America/New_York",
      options: [{ kind: "DATE_TIME", startAt: "2030-04-16T13:30:00.000Z" }],
    });
  });

  it("submits a combined run as one DATE_RANGE option", async () => {
    const submit = vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success);
    const { user } = renderComposer({ submit });

    await fillTitle(user);
    pick(DAY_ONE, DAY_TWO);
    toggleCombine();
    await commit(user);

    expect(submit).toHaveBeenCalledWith({
      title: "Planning review",
      description: null,
      ownerDisplayName: "Ada Lovelace",
      type: "DATE_RANGE",
      optionLimit: 10,
      coOrganizerEmails: [],
      timeZone: "America/New_York",
      options: [{ kind: "DATE_RANGE", startDate: DAY_ONE, endDate: DAY_TWO }],
    });
  });

  it("submits a combined run with times as one DATE_TIME_RANGE option", async () => {
    const submit = vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success);
    const { user } = renderComposer({ submit });

    await fillTitle(user);
    pick(DAY_ONE, DAY_TWO);
    toggleCombine();
    change("Start time", "09:30");
    change("End time", "10:45");
    await commit(user);

    expect(submit).toHaveBeenCalledWith({
      title: "Planning review",
      description: null,
      ownerDisplayName: "Ada Lovelace",
      type: "DATE_TIME_RANGE",
      optionLimit: 10,
      coOrganizerEmails: [],
      timeZone: "America/New_York",
      options: [{
        kind: "DATE_TIME_RANGE",
        startAt: "2030-04-16T13:30:00.000Z",
        endAt: "2030-04-17T14:45:00.000Z",
      }],
    });
  });

  it("submits an uncombined day with both times as a same-day DATE_TIME_RANGE", async () => {
    const submit = vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success);
    const { user } = renderComposer({ submit });

    await fillTitle(user);
    pick(DAY_ONE);
    change("Start time", "09:30");
    change("End time", "10:45");
    await commit(user);

    expect(submit).toHaveBeenCalledWith({
      title: "Planning review",
      description: null,
      ownerDisplayName: "Ada Lovelace",
      type: "DATE_TIME_RANGE",
      optionLimit: 10,
      coOrganizerEmails: [],
      timeZone: "America/New_York",
      options: [{
        kind: "DATE_TIME_RANGE",
        startAt: "2030-04-16T13:30:00.000Z",
        endAt: "2030-04-16T14:45:00.000Z",
      }],
    });
  });
});

describe("AppointmentComposer validation", () => {
  it("blocks a missing title", async () => {
    const { user, submit } = renderComposer();

    pick(DAY_ONE);
    await commit(user);

    expect(submit).not.toHaveBeenCalled();
    expect(alertText("composer-title-error")).toBe("Add a title.");
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Title").getAttribute("aria-describedby")).toBe("composer-title-error");
  });

  it("blocks a creation with no picked day", async () => {
    const { user, submit } = renderComposer();

    await fillTitle(user);
    await commit(user);

    expect(submit).not.toHaveBeenCalled();
    expect(alertText("composer-options-error")).toBe("Pick at least one day.");
  });

  it("blocks a day whose end time is not after its start time", async () => {
    const { user, submit } = renderComposer();

    await fillTitle(user);
    pick(DAY_ONE);
    change("Start time", "10:00");
    change("End time", "10:00");
    await commit(user);

    expect(submit).not.toHaveBeenCalled();
    expect(alertText("composer-options-error")).toBe("End time must be after start time.");
  });

  it("flags an impossible per-day span on its own chip as it is typed", async () => {
    const { user, submit } = renderComposer();

    await fillTitle(user);
    pick(DAY_ONE, DAY_TWO);
    change("Start time", "09:00");
    change("End time", "10:30");
    const chips = screen.getByRole("list", { name: "Selected days" });
    expect(chips.children[0].getAttribute("data-invalid")).toBeNull();
    expect(chips.children[1].getAttribute("data-invalid")).toBeNull();

    change(`Start time for ${LABEL_TWO}`, "14:00");

    expect(chips.children[0].getAttribute("data-invalid")).toBeNull();
    expect(chips.children[1].getAttribute("data-invalid")).toBe("true");
    expect(chips.children[1].textContent).toContain("End time must be after start time.");
    const invalidEnd = screen.getByLabelText(`End time for ${LABEL_TWO}`);
    expect(invalidEnd.getAttribute("aria-invalid")).toBe("true");
    expect(invalidEnd.getAttribute("aria-describedby")).toBe(`composer-chip-error-${DAY_TWO}`);
    expect(document.getElementById(`composer-chip-error-${DAY_TWO}`)).not.toBeNull();

    await commit(user);
    expect(submit).not.toHaveBeenCalled();

    change(`End time for ${LABEL_TWO}`, "16:00");

    expect(screen.getByRole("list", { name: "Selected days" }).children[1].getAttribute("data-invalid")).toBeNull();
    expect(screen.queryByLabelText(`End time for ${LABEL_TWO}`)?.getAttribute("aria-invalid")).toBe("false");
  });

  it("blocks a wall time inside a daylight-saving gap with the exact message", async () => {
    const { user, submit } = renderComposer();

    await fillTitle(user);
    stepMonths(11);
    pick("2031-03-09");
    change("Start time", "02:30");
    await commit(user);

    expect(submit).not.toHaveBeenCalled();
    expect(alertText("composer-options-error")).toBe("Enter a real local date and time.");
  });

  it("opens the advanced panel when the option limit cannot hold the picked days", async () => {
    const { user, submit } = renderComposer();

    await fillTitle(user);
    await openAdvanced(user);
    const limit = screen.getByLabelText("Option limit");
    await user.clear(limit);
    await user.type(limit, "1");
    await user.click(screen.getByRole("button", { name: "More settings" }));
    expect(screen.queryByLabelText("Option limit")).toBeNull();

    pick(DAY_ONE, DAY_APART);
    await commit(user);

    expect(submit).not.toHaveBeenCalled();
    expect(alertText("composer-option-limit-error")).toBe("Use an option limit of at least 2, or remove days.");
    expect(screen.getByLabelText("Option limit").getAttribute("aria-invalid")).toBe("true");
  });

  it("rejects an option limit outside one to one hundred", async () => {
    const { user, submit } = renderComposer();

    await fillTitle(user);
    await openAdvanced(user);
    const limit = screen.getByLabelText("Option limit");
    await user.clear(limit);
    await user.type(limit, "0");
    pick(DAY_ONE);
    await commit(user);

    expect(submit).not.toHaveBeenCalled();
    expect(alertText("composer-option-limit-error")).toBe("Enter a whole number from 1 to 100.");
  });
});

describe("AppointmentComposer co-organizers", () => {
  it("rejects case-insensitive duplicates", async () => {
    const { user } = renderComposer();
    await openAdvanced(user);
    const email = screen.getByLabelText("Co-organizer email");

    await user.type(email, "Person@Example.com");
    await user.click(screen.getByRole("button", { name: "Add co-organizer" }));
    await user.type(screen.getByLabelText("Co-organizer email"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Add co-organizer" }));

    expect(alertText("composer-co-organizer-email-error")).toBe("This co-organizer has already been added.");
    expect(screen.getAllByRole("button", { name: /Remove co-organizer/ })).toHaveLength(1);
  });

  it("caps co-organizers at twenty and reports the count", async () => {
    const { user } = renderComposer();
    await openAdvanced(user);

    for (let index = 0; index < 20; index += 1) {
      await user.type(screen.getByLabelText("Co-organizer email"), `person${index}@example.com`);
      await user.click(screen.getByRole("button", { name: "Add co-organizer" }));
    }

    expect((screen.getByRole("button", { name: "Add co-organizer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("20 of 20 co-organizers added")).not.toBeNull();
  });

  it("normalizes a pending co-organizer into the created payload", async () => {
    const submit = vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success);
    const { user } = renderComposer({ submit });

    await fillTitle(user);
    await openAdvanced(user);
    await user.type(screen.getByLabelText("Co-organizer email"), " Person@Example.com ");
    pick(DAY_ONE);
    await commit(user);

    expect(submit).toHaveBeenCalledWith({
      title: "Planning review",
      description: null,
      ownerDisplayName: "Ada Lovelace",
      type: "DATE",
      optionLimit: 10,
      coOrganizerEmails: ["person@example.com"],
      timeZone: "America/New_York",
      options: [{ kind: "DATE", startDate: DAY_ONE }],
    });
    expect((screen.getByLabelText("Co-organizer email") as HTMLInputElement).value).toBe("");
  });

  it("blocks creation on an invalid pending co-organizer with the exact message", async () => {
    const { user, submit } = renderComposer();

    await fillTitle(user);
    await openAdvanced(user);
    await user.type(screen.getByLabelText("Co-organizer email"), "not-an-email");
    pick(DAY_ONE);
    await commit(user);

    expect(submit).not.toHaveBeenCalled();
    expect(alertText("composer-co-organizer-email-error")).toBe("Enter one valid Google email address.");
  });
});

describe("AppointmentComposer submission", () => {
  it("suppresses a duplicate create while one is pending and locks the controls", async () => {
    let resolveSubmit: ((value: CreateAppointmentSuccess) => void) | undefined;
    const submit = vi.fn<CreateAppointmentSubmit>().mockImplementation(() => new Promise((resolve) => {
      resolveSubmit = resolve;
    }));
    const { user } = renderComposer({ submit });

    await fillTitle(user);
    pick(DAY_ONE);
    const create = screen.getByRole("button", { name: "Create and copy link" });

    fireEvent.click(create);
    fireEvent.click(create);

    expect(submit).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Creating…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Title") as HTMLInputElement).disabled).toBe(true);
    expect(dayButton(DAY_ONE).disabled).toBe(true);
    expect((screen.getByRole("button", { name: `Remove ${LABEL_ONE}` }) as HTMLButtonElement).disabled).toBe(true);

    resolveSubmit?.(success);
    await settle();

    expect(screen.getByLabelText("Public appointment link")).not.toBeNull();
  });

  it("shares the created link, copies it, and resets the composition", async () => {
    const copyText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    const { user } = renderComposer({ copyText });

    await fillTitle(user);
    pick(DAY_ONE);
    change("Start time", "09:30");
    await commit(user);

    const link = screen.getByLabelText("Public appointment link") as HTMLInputElement;
    expect(link.value).toBe(success.publicUrl);
    expect(link.readOnly).toBe(true);
    const open = screen.getByRole("link", { name: "Open appointment" });
    expect(open.getAttribute("href")).toBe(success.publicUrl);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noreferrer");
    expect(copyText).toHaveBeenCalledWith(success.publicUrl);
    expect(screen.getByRole("status").textContent).toBe("Link copied.");

    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("");
    expect(dayButton(DAY_ONE).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("list", { name: "Selected days" })).toBeNull();
  });

  it("keeps the creation on a failed copy and offers a manual retry", async () => {
    const copyText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("denied"));
    const { user } = renderComposer({ copyText });

    await fillTitle(user);
    pick(DAY_ONE);
    await commit(user);

    expect(screen.getByLabelText("Public appointment link")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(
      "Copy failed. Select the link above and copy it manually.",
    );
    expect((screen.getByRole("button", { name: "Copy link" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("AppointmentComposer error mapping", () => {
  async function submitFailing(fieldErrors?: Record<string, string[]>, message = "Check the submitted fields.") {
    const submit = vi.fn<CreateAppointmentSubmit>().mockRejectedValue(
      new CreateAppointmentRequestError("VALIDATION_FAILED", message, fieldErrors),
    );
    return renderComposer({ submit });
  }

  it("routes a dotted option error to its day and marks that chip", async () => {
    const { user, submit } = await submitFailing({
      "options.0.startDate": ["Start date must be today or later."],
    });

    await fillTitle(user);
    pick(DAY_APART);
    await commit(user);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(alertText("composer-options-error")).toBe("April 20, 2030: Start date must be today or later.");
    const invalid = document.querySelectorAll('[data-invalid="true"]');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].textContent).toContain("April 20, 2030");
    expect(alertText("composer-submit-error")).toBeUndefined();
  });

  it("wires a title field error back onto the title input", async () => {
    const { user } = await submitFailing({ title: ["Choose a more specific title."] });

    await fillTitle(user);
    pick(DAY_ONE);
    await commit(user);

    expect(alertText("composer-title-error")).toBe("Choose a more specific title.");
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Title").getAttribute("aria-describedby")).toBe("composer-title-error");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Planning review");
  });

  it("reopens the advanced panel with an email-prefixed co-organizer error", async () => {
    const { user } = await submitFailing({
      "coOrganizerEmails.0": ["Remove the duplicate co-organizer."],
    });

    await fillTitle(user);
    await openAdvanced(user);
    await user.type(screen.getByLabelText("Co-organizer email"), "grace@example.com");
    await user.click(screen.getByRole("button", { name: "Add co-organizer" }));
    await user.click(screen.getByRole("button", { name: "More settings" }));
    expect(screen.queryByLabelText("Co-organizer email")).toBeNull();

    pick(DAY_ONE);
    await commit(user);

    expect(screen.getByRole("button", { name: "More settings" }).getAttribute("aria-expanded")).toBe("true");
    expect(alertText("composer-co-organizers-error")).toBe(
      "grace@example.com: Remove the duplicate co-organizer.",
    );
  });

  it("routes a time zone error onto the options slot", async () => {
    const { user } = await submitFailing({ timeZone: ["Use a valid IANA time zone."] });

    await fillTitle(user);
    pick(DAY_ONE);
    await commit(user);

    expect(alertText("composer-options-error")).toBe("Use a valid IANA time zone.");
  });

  it("falls back to the API message when nothing maps", async () => {
    const { user } = await submitFailing({});

    await fillTitle(user);
    pick(DAY_ONE);
    await commit(user);

    expect(alertText("composer-submit-error")).toBe("Check the submitted fields.");
  });

  it("reports a transport failure with the exact connection sentence", async () => {
    const submit = vi.fn<CreateAppointmentSubmit>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(success);
    const { user } = renderComposer({ submit });

    await fillTitle(user);
    pick(DAY_ONE);
    await commit(user);

    expect(alertText("composer-submit-error")).toBe(
      "The appointment could not be created. Check your connection and try again.",
    );
    expect(dayButton(DAY_ONE).getAttribute("aria-pressed")).toBe("true");

    await commit(user);

    expect(screen.getByLabelText("Public appointment link")).not.toBeNull();
  });
});

describe("AppointmentComposer before hydration", () => {
  /**
   * The real sequence, not a simulation of it: server-render the composer, type
   * into the field while React is still loading, then hydrate. The title input is
   * autoFocused, so this is what a person on a slow connection actually does. A
   * change event never reaches React, so without adoption the title stays out of
   * state and creation fails with "Add a title." — with the title on screen.
   */
  async function hydrateWithTypedTitle(
    typed: string,
  ): Promise<{ submit: ReturnType<typeof vi.fn<CreateAppointmentSubmit>> }> {
    const submit = vi.fn<CreateAppointmentSubmit>().mockResolvedValue(success);
    const element = (
      <AppointmentComposer
        defaultOwnerDisplayName="Ada Lovelace"
        submit={submit}
        copyText={vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)}
        now={now}
      />
    );

    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    document.body.append(container);

    const input = container.querySelector<HTMLInputElement>("#composer-title");
    if (!input) throw new Error("Server render carried no title field");
    input.value = typed;

    await act(async () => {
      hydrateRoot(container, element);
    });
    return { submit };
  }

  it("keeps a title typed before React attached", async () => {
    const { submit } = await hydrateWithTypedTitle("Typed before hydration");

    expect(document.querySelector<HTMLInputElement>("#composer-title")?.value)
      .toBe("Typed before hydration");

    fireEvent.click(dayButton(DAY_ONE));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create and copy link" }));
    });
    await settle();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      title: "Typed before hydration",
    });
    expect(screen.queryByRole("alert", { name: undefined })).toBeNull();
  });
});
