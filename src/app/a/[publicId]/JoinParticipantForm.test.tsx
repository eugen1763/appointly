// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installMemoryLocalStorage } from "./browser-storage-test-support";
import { JoinParticipantForm } from "./JoinParticipantForm";
import { activeParticipantStorageKey } from "./guest-selection-storage";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000123";
const EDIT_URL = `/a/${PUBLIC_ID}/edit#participant=${PARTICIPANT_ID}&token=${"A".repeat(43)}`;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let copy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installMemoryLocalStorage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderForm(): void {
  act(() => root.render(<JoinParticipantForm publicId={PUBLIC_ID} />));
}

function field(): HTMLInputElement {
  const input = container.querySelector('input[name="displayName"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Display name field not found");
  return input;
}

async function submitName(name = "Avery Guest"): Promise<void> {
  const input = field();
  const form = container.querySelector("form");
  if (!(form instanceof HTMLFormElement)) throw new Error("Join form not found");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter not found");
    setter.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("JoinParticipantForm", () => {
  it("renders an accessible display-name join form", () => {
    renderForm();
    const label = container.querySelector('label[for="participant-display-name"]');
    expect(label?.textContent).toContain("Display name");
    expect(field().id).toBe("participant-display-name");
    expect(field().getAttribute("maxlength")).toBe("80");
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe("Join appointment");
  });

  it("shows the one-time guest private link and copies it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      participantId: PARTICIPANT_ID,
      editUrl: EDIT_URL,
      revision: 2,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    renderForm();

    await submitName();

    expect(fetchMock).toHaveBeenCalledWith(`/api/appointments/${PUBLIC_ID}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Avery Guest" }),
    });
    expect(container.textContent).toContain("This private link appears once");
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBe(PARTICIPANT_ID);
    expect(container.querySelector(`a[href="${EDIT_URL}"]`)?.textContent).toContain("Private edit link");
    const copyButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Copy private link");
    expect(copyButton).toBeDefined();

    await act(async () => copyButton?.click());
    expect(copy).toHaveBeenCalledWith(EDIT_URL);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Private link copied");
  });

  it("shows pending-manager completion without any private link", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      participantId: PARTICIPANT_ID,
      revision: 2,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    renderForm();

    await submitName("Manager Name");

    expect(container.textContent).toContain("You joined as a co-organizer");
    expect(container.textContent).not.toContain("private link");
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("reports the participant after a successful join", async () => {
    const onJoined = vi.fn();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      participantId: PARTICIPANT_ID,
      revision: 2,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    act(() => root.render(
      <JoinParticipantForm publicId={PUBLIC_ID} onJoined={onJoined} />,
    ));

    await submitName("Manager Name");

    expect(onJoined).toHaveBeenCalledWith(PARTICIPANT_ID);
  });

  it.each([
    ["extra-key", () => new Response(JSON.stringify({
      participantId: PARTICIPANT_ID,
      revision: 2,
      extra: "not allowed",
    }), { status: 201, headers: { "content-type": "application/json" } })],
    ["truncated", () => new Response(JSON.stringify({
      participantId: PARTICIPANT_ID,
      editUrl: EDIT_URL,
    }), { status: 201, headers: { "content-type": "application/json" } })],
    ["malformed JSON", () => new Response("{", {
      status: 201,
      headers: { "content-type": "application/json" },
    })],
  ])("keeps the form for a malformed %s 2xx response", async (_label, response) => {
    fetchMock.mockResolvedValue(response());
    renderForm();

    await submitName();

    expect(container.querySelector("form")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("Could not join the appointment. Try again.");
    expect(container.textContent).not.toContain("You joined as a co-organizer");
    expect(container.textContent).not.toContain("This private link appears once");
  });

  it("keeps the form and announces a stable API error", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { code: "NAME_TAKEN", message: "That display name is already in use." },
    }), { status: 409, headers: { "content-type": "application/json" } }));
    renderForm();

    await submitName();

    expect(container.querySelector("form")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("That display name is already in use.");
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });
});

describe("JoinParticipantForm before hydration", () => {
  /**
   * Reproduces a guest typing into the server-rendered field before React takes
   * over: the DOM carries the name but no change event ever reached React. A
   * controlled input would post "" here and silently lose the guest's name.
   */
  async function submitWithoutNotifyingReact(name: string): Promise<void> {
    const input = field();
    const form = container.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("Join form not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter not found");
    setter.call(input, name);
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  it("posts the name the field is actually carrying", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      participantId: PARTICIPANT_ID,
      editUrl: EDIT_URL,
      revision: 2,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    renderForm();

    await submitWithoutNotifyingReact("Pre Hydration Guest");

    expect(fetchMock).toHaveBeenCalledWith(`/api/appointments/${PUBLIC_ID}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Pre Hydration Guest" }),
    });
  });
});
