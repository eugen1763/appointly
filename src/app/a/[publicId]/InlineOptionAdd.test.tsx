// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/a/abcdefghijklmnopqrstuvwx"}

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { OptionInput } from "../../../features/appointments/contracts";
import { InlineOptionAdd } from "./InlineOptionAdd";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000001";
const OPTION_ID = "00000000-0000-4000-8000-000000000101";
const NOW = () => new Date("2030-04-15T12:00:00");

interface DeferredResponse {
  readonly promise: Promise<Response>;
  resolve(response: Response): void;
}

function deferredResponse(): DeferredResponse {
  let resolvePromise: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(response) {
      if (resolvePromise === undefined) throw new Error("Deferred response is not ready");
      resolvePromise(response);
    },
  };
}

function success(): Response {
  return new Response(JSON.stringify({ optionId: OPTION_ID, revision: 2 }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock;
let onAdded: Mock;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  onAdded = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    locale: "en-US",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "America/New_York",
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderAdd(appointmentType: OptionInput["kind"] = "DATE"): void {
  act(() => root.render(
    <InlineOptionAdd
      appointmentType={appointmentType}
      now={NOW}
      participantId={PARTICIPANT_ID}
      publicId={PUBLIC_ID}
      onAdded={onAdded}
    />,
  ));
}

function toggle(): HTMLButtonElement {
  const button = container.querySelector("button[aria-controls='add-option-panel']");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Add toggle not found");
  return button;
}

function openPanel(appointmentType: OptionInput["kind"] = "DATE"): void {
  renderAdd(appointmentType);
  act(() => toggle().click());
}

function day(isoDay: string): HTMLButtonElement {
  const button = container.querySelector(`[data-date="${isoDay}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Day ${isoDay} not found`);
  return button;
}

async function clickDay(isoDay: string): Promise<void> {
  await act(async () => day(isoDay).click());
}

function setTime(id: string, value: string): void {
  const input = container.querySelector(`#${id}`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Field ${id} not found`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter not found");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(): Promise<void> {
  const form = container.querySelector('form[aria-label="Suggest an option"]');
  if (!(form instanceof HTMLFormElement)) throw new Error("Suggestion form not found");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function summary(): string {
  return container.querySelector("[data-picked-days]")?.textContent ?? "";
}

function alertText(): string | undefined {
  return container.querySelector('[role="alert"]')?.textContent ?? undefined;
}

describe("InlineOptionAdd", () => {
  it("keeps the picker collapsed behind a labelled disclosure", () => {
    renderAdd();

    expect(toggle().textContent).toBe("＋ Add an option");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-controls")).toBe("add-option-panel");
    expect(container.querySelector("#add-option-panel")).toBeNull();

    act(() => toggle().click());

    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("#add-option-panel")).not.toBeNull();
    expect(container.querySelector('form[aria-label="Suggest an option"]')).not.toBeNull();
  });

  it("opens on the current month and blocks past days", () => {
    openPanel();

    expect(container.querySelector("[data-cal-month]")?.textContent).toBe("April 2030");
    expect(day("2030-04-14").disabled).toBe(true);
    expect(day("2030-04-15").disabled).toBe(false);
    expect(day("2030-04-15").getAttribute("data-today")).toBe("1");
  });

  it("posts a day appointment option from a single click with no submit button", async () => {
    fetchMock.mockResolvedValueOnce(success());
    openPanel();

    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(summary()).toBe("Click a day to add it as an option.");

    await clickDay("2030-04-17");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(`/api/appointments/${PUBLIC_ID}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: PARTICIPANT_ID,
        timeZone: "America/New_York",
        option: { kind: "DATE", startDate: "2030-04-17" },
      }),
    });
    expect(onAdded).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Suggestion added.");
    // Each click is one complete suggestion, so nothing stays picked afterwards.
    expect(day("2030-04-17").getAttribute("aria-pressed")).toBe("false");
  });

  it("locks a day appointment to one request per burst of clicks", async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValue(pending.promise);
    openPanel();

    await act(async () => {
      day("2030-04-17").click();
      day("2030-04-18").click();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);

    await act(async () => pending.resolve(success()));
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(false);
    expect(onAdded).toHaveBeenCalledOnce();
  });

  it("requires a real local date and time before sending a timed suggestion", async () => {
    openPanel("DATE_TIME");

    await submit();

    expect(alertText()).toBe("Enter a real local date and time.");
    expect(fetchMock).not.toHaveBeenCalled();

    await clickDay("2030-04-17");
    await submit();

    expect(alertText()).toBe("Enter a real local date and time.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("selects a single day for a timed appointment and submits it with the time", async () => {
    fetchMock.mockResolvedValueOnce(success());
    openPanel("DATE_TIME");

    await clickDay("2030-04-17");
    expect(summary()).toBe("April 17, 2030");
    await clickDay("2030-04-18");
    expect(summary()).toBe("April 18, 2030");
    expect(day("2030-04-17").getAttribute("aria-pressed")).toBe("false");
    await clickDay("2030-04-18");
    expect(summary()).toBe("Pick a day.");
    await clickDay("2030-04-18");
    setTime("suggestion-time", "09:30");

    await submit();

    expect(fetchMock).toHaveBeenCalledWith(`/api/appointments/${PUBLIC_ID}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: PARTICIPANT_ID,
        timeZone: "America/New_York",
        option: {
          kind: "DATE_TIME",
          startAt: new Date(2030, 3, 18, 9, 30).toISOString(),
        },
      }),
    });
  });

  it("fills the two range slots in order and restarts below the start", async () => {
    fetchMock.mockResolvedValueOnce(success());
    openPanel("DATE_RANGE");

    expect(summary()).toBe("Pick a start and end day.");
    await clickDay("2030-04-20");
    expect(summary()).toBe("April 20, 2030 – pick an end day.");

    await clickDay("2030-04-18");
    expect(summary()).toBe("April 18, 2030 – pick an end day.");

    await clickDay("2030-04-21");
    expect(summary()).toBe("April 18, 2030 – April 21, 2030");
    expect(Array.from(
      container.querySelectorAll('[data-date][aria-pressed="true"]'),
      (node) => node.getAttribute("data-date"),
    )).toEqual(["2030-04-18", "2030-04-19", "2030-04-20", "2030-04-21"]);

    await submit();

    expect(fetchMock).toHaveBeenCalledWith(`/api/appointments/${PUBLIC_ID}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: PARTICIPANT_ID,
        timeZone: "America/New_York",
        option: {
          kind: "DATE_RANGE",
          startDate: "2030-04-18",
          endDate: "2030-04-21",
        },
      }),
    });
  });

  it("refuses an incomplete range without sending a request", async () => {
    openPanel("DATE_RANGE");
    await clickDay("2030-04-20");

    await submit();

    expect(alertText()).toBe("Choose a start and end date.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends both boundaries of a timed range", async () => {
    fetchMock.mockResolvedValueOnce(success());
    openPanel("DATE_TIME_RANGE");

    await clickDay("2030-04-18");
    await clickDay("2030-04-19");
    setTime("suggestion-start-time", "09:30");
    setTime("suggestion-end-time", "11:00");

    await submit();

    expect(fetchMock).toHaveBeenCalledWith(`/api/appointments/${PUBLIC_ID}/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: PARTICIPANT_ID,
        timeZone: "America/New_York",
        option: {
          kind: "DATE_TIME_RANGE",
          startAt: new Date(2030, 3, 18, 9, 30).toISOString(),
          endAt: new Date(2030, 3, 19, 11, 0).toISOString(),
        },
      }),
    });
  });

  it("keeps the picks after a duplicate-option rejection", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: "DUPLICATE_OPTION", message: "That option already exists." },
    }), { status: 409, headers: { "content-type": "application/json" } }));
    openPanel("DATE_RANGE");
    await clickDay("2030-04-18");
    await clickDay("2030-04-19");

    await submit();

    expect(alertText()).toBe("That option already exists.");
    expect(summary()).toBe("April 18, 2030 – April 19, 2030");
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("shows the first submitted field error from a validation response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: "VALIDATION_FAILED",
        message: "Check the submitted fields.",
        fieldErrors: { "option.startDate": ["Choose today or a future date."] },
      },
    }), { status: 400, headers: { "content-type": "application/json" } }));
    openPanel();

    await clickDay("2030-04-17");

    expect(alertText()).toBe("Choose today or a future date.");
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("rejects a malformed success response without refreshing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      optionId: "not-a-uuid",
      revision: 2,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    openPanel();

    await clickDay("2030-04-17");

    expect(alertText()).toBe("The server returned an invalid suggestion response. Try again.");
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("locks duplicate submits until the request settles", async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValue(pending.promise);
    openPanel("DATE_RANGE");
    await clickDay("2030-04-18");
    await clickDay("2030-04-19");
    const form = container.querySelector('form[aria-label="Suggest an option"]');
    if (!(form instanceof HTMLFormElement)) throw new Error("Suggestion form not found");

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector('button[type="submit"]')?.textContent)
      .toBe("Adding suggestion…");

    await act(async () => pending.resolve(success()));
    expect(container.querySelector("fieldset")?.hasAttribute("disabled")).toBe(false);
    expect(summary()).toBe("Pick a start and end day.");
  });

  it("steps the calendar month without touching the picks", async () => {
    openPanel("DATE_TIME");
    await clickDay("2030-04-18");

    const next = container.querySelector('button[aria-label="Next month"]');
    if (!(next instanceof HTMLButtonElement)) throw new Error("Next month button not found");
    act(() => next.click());

    expect(container.querySelector("[data-cal-month]")?.textContent).toBe("May 2030");
    expect(summary()).toBe("April 18, 2030");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
