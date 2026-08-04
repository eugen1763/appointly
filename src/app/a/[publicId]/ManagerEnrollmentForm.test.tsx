// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { ManagerEnrollmentForm } from "./ManagerEnrollmentForm";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000501";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock;
let onEnrolled: Mock;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  onEnrolled = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderForm(
  enrollmentError: "PARTICIPANT_LIMIT_REACHED" | null = null,
): Promise<void> {
  await act(async () => root.render(
    <ManagerEnrollmentForm
      enrollmentError={enrollmentError}
      publicId={PUBLIC_ID}
      onEnrolled={onEnrolled}
    />,
  ));
}

function form(): HTMLFormElement | null {
  return container.querySelector("form[aria-label='Join as participant']");
}

function nameInput(): HTMLInputElement {
  const element = container.querySelector("#manager-participant-display-name");
  if (!(element instanceof HTMLInputElement)) throw new Error("Name input not found");
  return element;
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null;
}

async function submitName(value: string): Promise<void> {
  const input = nameInput();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter not found");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    form()?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("ManagerEnrollmentForm", () => {
  it("sends exactly the display name and reports the new participant", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      participantId: PARTICIPANT_ID,
      revision: 3,
    }, 201));
    await renderForm();
    await submitName("Casey the Second");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/appointments/${PUBLIC_ID}/manager-participant`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"displayName":"Casey the Second"}');
    expect(onEnrolled).toHaveBeenCalledExactlyOnceWith(PARTICIPANT_ID);
    expect(nameInput().maxLength).toBe(80);
  });

  it("accepts a 200 as readily as a 201", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      participantId: PARTICIPANT_ID,
      revision: 3,
    }, 200));
    await renderForm();
    await submitName("Casey the Second");

    expect(onEnrolled).toHaveBeenCalledExactlyOnceWith(PARTICIPANT_ID);
    expect(alertText()).toBeNull();
  });

  it("reports a name collision from the server", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      error: {
        code: "NAME_TAKEN",
        message: "That participant name is already in use.",
      },
    }, 409));
    await renderForm();
    await submitName("Casey Co-organizer");

    expect(alertText()).toBe("That participant name is already in use.");
    expect(onEnrolled).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for an uncontracted failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "TEAPOT" } }, 500));
    await renderForm();
    await submitName("Casey the Second");

    expect(alertText()).toBe("Joining did not complete. Check your connection and try again.");
  });

  it("states the participant limit instead of offering a form", async () => {
    await renderForm("PARTICIPANT_LIMIT_REACHED");

    expect(form()).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "This appointment has reached its participant limit, so you cannot respond.",
    );
  });

  it("locks a duplicate submit while the first is in flight", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    await renderForm();
    await submitName("Casey the Second");

    expect(nameInput().disabled).toBe(true);
    await act(async () => {
      form()?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveResponse?.(jsonResponse({ participantId: PARTICIPANT_ID, revision: 3 }, 201));
    });
    expect(onEnrolled).toHaveBeenCalledExactlyOnceWith(PARTICIPANT_ID);
  });
});

describe("ManagerEnrollmentForm before hydration", () => {
  /** Same server-rendered hazard as the guest join form: typing can precede React. */
  it("posts the name the field is actually carrying", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      participantId: PARTICIPANT_ID,
      revision: 3,
    }, 201));
    await renderForm();

    const input = nameInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter not found");
    setter.call(input, "Pre Hydration Manager");
    await act(async () => {
      form()?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"displayName":"Pre Hydration Manager"}');
    expect(onEnrolled).toHaveBeenCalledExactlyOnceWith(PARTICIPANT_ID);
  });
});
