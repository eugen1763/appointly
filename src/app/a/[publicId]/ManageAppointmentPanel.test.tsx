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

describe("ManageAppointmentPanel co-organizers", () => {
  const OWNER_MANAGER = {
    id: "00000000-0000-4000-8000-000000000901",
    email: "owner@example.com",
    role: "OWNER",
    status: "BOUND",
    canRemove: false,
  } as const;
  const CO_ORGANIZER = {
    id: "00000000-0000-4000-8000-000000000902",
    email: "casey@example.com",
    role: "COORGANIZER",
    status: "PENDING",
    canRemove: true,
  } as const;

  async function renderOwnerPanel(): Promise<void> {
    await renderPanel({
      permissions: {
        ...NO_PERMISSIONS,
        canEditAppointment: true,
        canManageCoOrganizers: true,
      },
    });
  }

  function managerRows(): readonly HTMLLIElement[] {
    const list = container.querySelector("ul[aria-label='Co-organizers']");
    return list === null ? [] : Array.from(list.querySelectorAll("li"));
  }

  function emailInput(): HTMLInputElement {
    const element = container.querySelector("#manage-co-organizer-email");
    if (!(element instanceof HTMLInputElement)) throw new Error("Email input not found");
    return element;
  }

  async function setEmail(value: string): Promise<void> {
    const input = emailInput();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("Input value setter not found");
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("loads the list once on first expand and lists owner and co-organizer rows", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      managers: [OWNER_MANAGER, CO_ORGANIZER],
    }));
    await renderOwnerPanel();

    expect(fetchMock).not.toHaveBeenCalled();

    await openPanel();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `/api/appointments/${PUBLIC_ID}/managers`,
    );
    expect(managerRows()).toHaveLength(2);
    expect(managerRows()[0]?.textContent).toContain("owner@example.com");
    expect(managerRows()[0]?.textContent).toContain("Owner");
    expect(managerRows()[0]?.querySelector("button")).toBeNull();
    expect(managerRows()[1]?.textContent).toContain("Pending");
    expect(managerRows()[1]?.querySelector("button")?.getAttribute("aria-label"))
      .toBe("Remove casey@example.com");
    expect(panel()?.textContent).toContain("1 of 20 co-organizers");

    await openPanel();
    await openPanel();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when the list cannot be loaded", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: { code: "FORBIDDEN", message: "Appointment owner access is required." },
    }, 403));
    await renderOwnerPanel();
    await openPanel();

    expect(alertText()).toContain("Appointment owner access is required.");

    fetchMock.mockResolvedValueOnce(jsonResponse({ managers: [OWNER_MANAGER] }));
    await act(async () => button("Retry").click());

    expect(managerRows()).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("appends the manager the server returned, not the typed address", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ managers: [OWNER_MANAGER] }));
    await renderOwnerPanel();
    await openPanel();

    fetchMock.mockResolvedValueOnce(jsonResponse({
      manager: { ...CO_ORGANIZER, status: "BOUND" },
      revision: 4,
    }, 201));
    await setEmail("  Casey@Example.COM ");
    await act(async () => button("Add co-organizer").click());

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/appointments/${PUBLIC_ID}/managers`);
    expect(init.method).toBe("POST");
    // type="email" strips surrounding whitespace itself; the case is left to the server.
    expect(init.body).toBe('{"email":"Casey@Example.COM"}');
    expect(managerRows()).toHaveLength(2);
    expect(managerRows()[1]?.textContent).toContain("casey@example.com");
    expect(managerRows()[1]?.textContent).toContain("Bound");
    expect(emailInput().value).toBe("");
    expect(panel()?.textContent).toContain("1 of 20 co-organizers");
  });

  it("surfaces duplicate and cap failures from the server", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ managers: [OWNER_MANAGER] }));
    await renderOwnerPanel();
    await openPanel();

    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "MANAGER_ALREADY_EXISTS",
        message: "That email already belongs to an appointment manager.",
      },
    }, 409));
    await setEmail("casey@example.com");
    await act(async () => button("Add co-organizer").click());

    expect(alertText()).toBe("That email already belongs to an appointment manager.");
    expect(managerRows()).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "COORGANIZER_LIMIT_REACHED",
        message: "This appointment already has 20 co-organizers.",
      },
    }, 409));
    await act(async () => button("Add co-organizer").click());

    expect(alertText()).toBe("This appointment already has 20 co-organizers.");
  });

  it("removes a row with a bodyless, headerless DELETE", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      managers: [OWNER_MANAGER, CO_ORGANIZER],
    }));
    await renderOwnerPanel();
    await openPanel();

    fetchMock.mockResolvedValueOnce(jsonResponse({ revision: 6 }));
    await act(async () => button("Remove").click());

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/appointments/${PUBLIC_ID}/managers/${CO_ORGANIZER.id}`);
    expect(init).toEqual({ method: "DELETE" });
    expect(managerRows()).toHaveLength(1);
    expect(panel()?.textContent).toContain("0 of 20 co-organizers");
  });

  it("keeps the loaded list across a close and reopen", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      managers: [OWNER_MANAGER, CO_ORGANIZER],
    }));
    await renderOwnerPanel();
    await openPanel();
    await openPanel();
    await openPanel();

    expect(managerRows()).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hides the section from a viewer who is not the owner", async () => {
    await renderPanel();
    await openPanel();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("ul[aria-label='Co-organizers']")).toBeNull();
  });
});

describe("ManageAppointmentPanel guest links", () => {
  const AVERY = { id: "00000000-0000-4000-8000-000000000801", displayName: "Avery Guest" };
  const BLAKE = { id: "00000000-0000-4000-8000-000000000802", displayName: "Blake Guest" };
  const EDIT_URL = `/a/${PUBLIC_ID}/edit#participant=${AVERY.id}&token=${"A".repeat(43)}`;

  async function renderGuestLinks(): Promise<void> {
    await renderPanel({
      participants: [AVERY, BLAKE],
      permissions: { ...NO_PERMISSIONS, canResetGuestLinks: true },
    });
  }

  function rows(): readonly HTMLLIElement[] {
    const list = container.querySelector("ul[aria-label='Guest links']");
    return list === null ? [] : Array.from(list.querySelectorAll("li"));
  }

  function averyRow(): HTMLLIElement {
    const row = rows()[0];
    if (row === undefined) throw new Error("Guest link row not found");
    return row;
  }

  function resetGroup(): HTMLElement | null {
    return container.querySelector<HTMLElement>(
      `[role="group"][aria-label="New private edit link for ${AVERY.displayName}"]`,
    );
  }

  async function armAndConfirm(): Promise<void> {
    await act(async () => button(`Reset link`).click());
    await act(async () => button("Confirm reset").click());
  }

  it("lists every participant, since the server accepts any of them", async () => {
    await renderGuestLinks();
    await openPanel();

    expect(rows()).toHaveLength(2);
    expect(averyRow().textContent).toContain(AVERY.displayName);
    expect(rows()[1]?.textContent).toContain(BLAKE.displayName);
    expect(averyRow().querySelector("button")?.getAttribute("aria-label"))
      .toBe(`Reset link for ${AVERY.displayName}`);
  });

  it("requires the inline confirm before sending anything", async () => {
    await renderGuestLinks();
    await openPanel();
    await act(async () => averyRow().querySelector("button")?.click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(averyRow().textContent).toContain(
      `Reset the link for ${AVERY.displayName}? The current link stops working.`,
    );

    await act(async () => button("Cancel").click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(averyRow().querySelector("button")?.getAttribute("aria-label"))
      .toBe(`Reset link for ${AVERY.displayName}`);
  });

  it("posts with no body and shows the once-only link", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      participantId: AVERY.id,
      editUrl: EDIT_URL,
      revision: 7,
    }));
    await renderGuestLinks();
    await openPanel();
    await armAndConfirm();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/appointments/${PUBLIC_ID}/participants/${AVERY.id}/reset-link`,
    );
    expect(init).toEqual({ method: "POST" });

    const group = resetGroup();
    expect(group).not.toBeNull();
    expect(group?.querySelector("a")?.getAttribute("href")).toBe(EDIT_URL);
    expect(group?.textContent).toContain(
      "This link appears once. The previous link no longer works.",
    );
    expect(group?.textContent).toContain("Copy private link");
    // Only the reset participant gets a link.
    expect(rows()[1]?.querySelector('[role="group"]')).toBeNull();
  });

  it("replaces the shown link when the same participant is reset again", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      participantId: AVERY.id,
      editUrl: EDIT_URL,
      revision: 7,
    }));
    await renderGuestLinks();
    await openPanel();
    await armAndConfirm();

    const secondUrl = `${EDIT_URL}-second`;
    fetchMock.mockResolvedValueOnce(jsonResponse({
      participantId: AVERY.id,
      editUrl: secondUrl,
      revision: 9,
    }));
    await armAndConfirm();

    expect(resetGroup()?.querySelectorAll("a")).toHaveLength(1);
    expect(resetGroup()?.querySelector("a")?.getAttribute("href")).toBe(secondUrl);
  });

  it("keeps the once-only link across a close and reopen", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      participantId: AVERY.id,
      editUrl: EDIT_URL,
      revision: 7,
    }));
    await renderGuestLinks();
    await openPanel();
    await armAndConfirm();
    await openPanel();
    await openPanel();

    expect(resetGroup()?.querySelector("a")?.getAttribute("href")).toBe(EDIT_URL);
  });

  it("reports the contract failure in the row", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "APPOINTMENT_FINALIZED",
        message: "Reopen the appointment before changing appointment details.",
      },
    }, 409));
    await renderGuestLinks();
    await openPanel();
    await armAndConfirm();

    expect(averyRow().querySelector('[role="alert"]')?.textContent)
      .toBe("Reopen the appointment before changing appointment details.");
    expect(resetGroup()).toBeNull();
  });

  it("falls back to a generic message for the uncontracted 500", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    }, 500));
    await renderGuestLinks();
    await openPanel();
    await armAndConfirm();

    expect(averyRow().querySelector('[role="alert"]')?.textContent)
      .toBe("The link could not be reset. Check your connection and try again.");
  });

  it("copies the link and reports both clipboard outcomes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      participantId: AVERY.id,
      editUrl: EDIT_URL,
      revision: 7,
    }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await renderGuestLinks();
    await openPanel();
    await armAndConfirm();
    await act(async () => button("Copy private link").click());

    expect(writeText).toHaveBeenCalledExactlyOnceWith(EDIT_URL);
    expect(resetGroup()?.textContent).toContain("Private link copied.");

    writeText.mockRejectedValueOnce(new Error("denied"));
    await act(async () => button("Copy private link").click());

    expect(resetGroup()?.textContent).toContain(
      "Copy failed. Open the private edit link and copy it from the address bar.",
    );
  });

  it("omits the section when there are no participants", async () => {
    await renderPanel({
      participants: [],
      permissions: { ...NO_PERMISSIONS, canResetGuestLinks: true },
    });
    await openPanel();

    expect(container.querySelector("ul[aria-label='Guest links']")).toBeNull();
  });
});
