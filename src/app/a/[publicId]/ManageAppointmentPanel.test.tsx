// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { AppointmentSnapshot } from "../../../features/appointments/contracts";
import {
  ManageAppointmentPanel,
  type ManageAppointmentPanelProps,
} from "./ManageAppointmentPanel";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";

type Permissions = AppointmentSnapshot["viewer"]["permissions"];

const NO_PERMISSIONS: Permissions = {
  canEditAppointment: false,
  canManageCoOrganizers: false,
  canDeleteAppointment: false,
  canFinalize: false,
  canReopen: false,
  canResetGuestLinks: false,
  canRespond: false,
  canSuggest: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock;
let onDetailsSaved: Mock;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  onDetailsSaved = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPanel(
  overrides: Partial<ManageAppointmentPanelProps> = {},
): Promise<void> {
  await act(async () => root.render(
    <ManageAppointmentPanel
      deleteControls={<button type="button" data-delete-appointment>Delete appointment</button>}
      optionCount={2}
      optionLimit={5}
      participants={[]}
      permissions={{ ...NO_PERMISSIONS, canEditAppointment: true }}
      publicId={PUBLIC_ID}
      onDetailsSaved={onDetailsSaved}
      {...overrides}
    />,
  ));
}

function toggle(): HTMLButtonElement {
  const element = container.querySelector("button[aria-controls='manage-panel']");
  if (!(element instanceof HTMLButtonElement)) throw new Error("Manage toggle not found");
  return element;
}

function panel(): HTMLElement | null {
  return container.querySelector<HTMLElement>("#manage-panel");
}

function button(name: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === name);
  if (element === undefined) throw new Error(`No button named ${name}`);
  return element;
}

function optionLimitInput(): HTMLInputElement {
  const element = container.querySelector("#manage-option-limit");
  if (!(element instanceof HTMLInputElement)) throw new Error("Option limit input not found");
  return element;
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null;
}

async function openPanel(): Promise<void> {
  await act(async () => toggle().click());
}

async function setOptionLimit(value: string): Promise<void> {
  const input = optionLimitInput();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter not found");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ManageAppointmentPanel shell", () => {
  it("renders nothing when the viewer manages nothing", async () => {
    await renderPanel({ permissions: NO_PERMISSIONS });

    expect(container.innerHTML).toBe("");
  });

  it("keeps the panel unmounted until the toggle is opened", async () => {
    await renderPanel();

    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(panel()).toBeNull();

    await openPanel();

    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(panel()).not.toBeNull();

    await openPanel();

    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(panel()).toBeNull();
  });

  it("keeps section state across a close and reopen", async () => {
    await renderPanel();
    await openPanel();
    await setOptionLimit("9");
    await openPanel();
    await openPanel();

    expect(optionLimitInput().value).toBe("9");
  });
});

describe("ManageAppointmentPanel option limit", () => {
  it("reports the current usage and offers the limit control to an editor", async () => {
    await renderPanel();
    await openPanel();

    expect(panel()?.textContent).toContain("Currently 2 of 5 options used.");
    expect(optionLimitInput().value).toBe("5");
    expect(optionLimitInput().min).toBe("1");
    expect(optionLimitInput().max).toBe("100");
  });

  it("sends the new limit and folds the revision back", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revision: 8 }));
    await renderPanel();
    await openPanel();
    await setOptionLimit("3");
    await act(async () => button("Save option limit").click());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/appointments/${PUBLIC_ID}`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"optionLimit":3}');
    expect(onDetailsSaved).toHaveBeenCalledExactlyOnceWith(8, { optionLimit: 3 });
  });

  it("sends nothing when the limit is unchanged", async () => {
    await renderPanel();
    await openPanel();
    await act(async () => button("Save option limit").click());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a limit below the current option count as an alert", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      error: {
        code: "LIMIT_BELOW_CURRENT_COUNT",
        message: "Option limit cannot be lower than the current option count.",
      },
    }, 409));
    await renderPanel();
    await openPanel();
    await setOptionLimit("1");
    await act(async () => button("Save option limit").click());

    expect(alertText()).toBe("Option limit cannot be lower than the current option count.");
    expect(onDetailsSaved).not.toHaveBeenCalled();
  });

  it("hides the limit control from a viewer who cannot edit details", async () => {
    await renderPanel({
      permissions: { ...NO_PERMISSIONS, canDeleteAppointment: true },
    });
    await openPanel();

    expect(container.querySelector("#manage-option-limit")).toBeNull();
    expect(panel()?.textContent).not.toContain("Option limit");
  });
});

describe("ManageAppointmentPanel delete section", () => {
  it("renders the delete controls inside the panel for an owner", async () => {
    await renderPanel({
      permissions: { ...NO_PERMISSIONS, canDeleteAppointment: true },
    });

    expect(container.querySelector("[data-delete-appointment]")).toBeNull();

    await openPanel();

    const deleteButton = container.querySelector("[data-delete-appointment]");
    expect(deleteButton).not.toBeNull();
    expect(panel()?.contains(deleteButton)).toBe(true);
  });

  it("omits the delete controls from a viewer who cannot delete", async () => {
    await renderPanel();
    await openPanel();

    expect(container.querySelector("[data-delete-appointment]")).toBeNull();
  });
});
