// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/a/abcdefghijklmnopqrstuvwx"}

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { AppointmentSnapshot } from "../../../features/appointments/contracts";
import { installMemoryLocalStorage } from "./browser-storage-test-support";
import { activeParticipantStorageKey } from "./guest-selection-storage";

const { replace, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import { AppointmentClient } from "./AppointmentClient";
import { ResponseControl } from "./ResponseControl";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000001";
const SECOND_PARTICIPANT_ID = "00000000-0000-4000-8000-000000000002";
const OPTION_ONE_ID = "00000000-0000-4000-8000-000000000101";
const OPTION_TWO_ID = "00000000-0000-4000-8000-000000000102";

const CONFIRMATION_TOKEN = "A".repeat(43);
const REPLACEMENT_TOKEN = `${"B".repeat(42)}E`;

const BASE_SNAPSHOT: AppointmentSnapshot = {
  appointment: {
    publicId: PUBLIC_ID,
    title: "Planning",
    description: null,
    type: "DATE",
    status: "ACTIVE",
    optionLimit: 10,
    finalOptionId: null,
    revision: 1,
  },
  participants: [{ id: PARTICIPANT_ID, displayName: "Avery" }],
  options: [
    {
      id: OPTION_ONE_ID,
      kind: "DATE",
      startDate: "2030-01-01",
      creatorParticipantId: PARTICIPANT_ID,
      responses: [{ participantId: PARTICIPANT_ID, value: "YES" }],
      yesCount: 1,
      noCount: 0,
      canDelete: true,
    },
    {
      id: OPTION_TWO_ID,
      kind: "DATE",
      startDate: "2030-01-02",
      creatorParticipantId: PARTICIPANT_ID,
      responses: [],
      yesCount: 0,
      noCount: 0,
      canDelete: true,
    },
  ],
  viewer: {
    kind: "guest",
    activeParticipantId: PARTICIPANT_ID,
    accessibleParticipants: [{ id: PARTICIPANT_ID, displayName: "Avery" }],
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

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly close = vi.fn();
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  message(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  error(): void {
    this.onerror?.(new Event("error"));
  }
}

function currentEventSource(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (source === undefined) throw new Error("EventSource was not created");
  return source;
}

function snapshotWithResponse(
  revision: number,
  value: "YES" | "NO",
): AppointmentSnapshot {
  return {
    ...BASE_SNAPSHOT,
    appointment: { ...BASE_SNAPSHOT.appointment, revision },
    options: BASE_SNAPSHOT.options.map((option) => option.id === OPTION_ONE_ID
      ? {
        ...option,
        responses: [{ participantId: PARTICIPANT_ID, value }],
        yesCount: value === "YES" ? 1 : 0,
        noCount: value === "NO" ? 1 : 0,
      }
      : option),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function confirmationResponse(
  code: "DELETE_CONFIRMATION_REQUIRED" | "STALE_DELETE_CONFIRMATION",
  names: readonly string[],
  token: string,
): Response {
  return jsonResponse({
    error: {
      code,
      message: code === "STALE_DELETE_CONFIRMATION"
        ? "Responses changed. Confirm the updated deletion."
        : "Confirm this deletion.",
      details: { count: names.length, names, token },
    },
  }, 409);
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock;

beforeEach(() => {
  installMemoryLocalStorage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  replace.mockReset();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        if (!this.hasAttribute("open")) return;
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      },
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function radio(optionId: string, value: "YES" | "NO" | "UNANSWERED"): HTMLInputElement {
  const input = container.querySelector(`input[name="response-${optionId}"][value="${value}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Radio ${optionId} ${value} not found`);
  return input;
}

function addOptionToggle(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(
    "button[aria-controls='add-option-panel']",
  );
}

function openAddOptionPanel(): void {
  const toggle = addOptionToggle();
  if (toggle === null) throw new Error("Add an option toggle not found");
  act(() => toggle.click());
}

function sumCell(optionId: string): HTMLElement | null {
  const row = container.querySelector(`tbody th[data-option-id="${optionId}"]`)?.closest("tr");
  return row?.querySelector<HTMLElement>("td:not([data-participant-id])") ?? null;
}

function deleteButton(optionId: string): HTMLButtonElement {
  const button = container.querySelector(`[data-delete-option="${optionId}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Delete button ${optionId} not found`);
  }
  return button;
}

function deleteDialog(): HTMLDialogElement {
  const dialog = container.querySelector("[data-delete-dialog]");
  if (!(dialog instanceof HTMLDialogElement)) {
    throw new Error("Delete confirmation dialog not found");
  }
  return dialog;
}

function success(value: "YES" | "NO" | null, revision: number): Response {
  return new Response(JSON.stringify({ value, revision }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AppointmentClient live updates", () => {
  it("opens one native stream, repairs the snapshot on initial open, and closes it on cleanup", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshotWithResponse(2, "NO")));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = currentEventSource();
    expect(source.url).toBe(`/api/appointments/${PUBLIC_ID}/events`);

    await act(async () => source.open());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);

    await act(async () => root.render(<></>));
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("does not resurrect the join form after a joined guest sees finalize and reopen updates", async () => {
    const guest = {
      id: SECOND_PARTICIPANT_ID,
      displayName: "Task 47 Returning Guest",
    };
    const anonymousSnapshot: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      options: BASE_SNAPSHOT.options.map((option) => ({
        ...option,
        canDelete: false,
      })),
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        kind: "anonymous",
        activeParticipantId: null,
        accessibleParticipants: [],
        permissions: {
          canEditAppointment: false,
          canManageCoOrganizers: false,
          canDeleteAppointment: false,
          canFinalize: false,
          canReopen: false,
          canResetGuestLinks: false,
          canRespond: false,
          canSuggest: false,
        },
      },
    };
    const joinedSnapshot: AppointmentSnapshot = {
      ...anonymousSnapshot,
      appointment: {
        ...anonymousSnapshot.appointment,
        revision: 2,
      },
      participants: [...anonymousSnapshot.participants, guest],
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        activeParticipantId: guest.id,
        accessibleParticipants: [guest],
      },
    };
    const finalizedSnapshot: AppointmentSnapshot = {
      ...joinedSnapshot,
      appointment: {
        ...joinedSnapshot.appointment,
        status: "FINALIZED",
        finalOptionId: OPTION_ONE_ID,
        revision: 3,
      },
      viewer: {
        ...joinedSnapshot.viewer,
        permissions: {
          ...joinedSnapshot.viewer.permissions,
          canRespond: false,
          canSuggest: false,
        },
      },
    };
    const reopenedSnapshot: AppointmentSnapshot = {
      ...joinedSnapshot,
      appointment: {
        ...joinedSnapshot.appointment,
        revision: 4,
      },
    };
    const participantRefresh = deferredResponse();
    const editUrl = `/a/${PUBLIC_ID}/edit#participant=${guest.id}&token=${CONFIRMATION_TOKEN}`;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        participantId: guest.id,
        editUrl,
        revision: 2,
      }, 201))
      .mockReturnValueOnce(participantRefresh.promise);
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={anonymousSnapshot} />,
    ));
    const source = currentEventSource();
    const joinForm = container.querySelector('form[aria-label="Join appointment"]');
    if (!(joinForm instanceof HTMLFormElement)) throw new Error("Join form not found");
    const displayName = joinForm.elements.namedItem("displayName");
    if (!(displayName instanceof HTMLInputElement)) {
      throw new Error("Display name input not found");
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Input value setter not found");
      setter.call(displayName, guest.displayName);
      displayName.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      joinForm.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/appointments/${PUBLIC_ID}/participants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: guest.displayName }),
      },
    );
    await act(async () => participantRefresh.resolve(jsonResponse(joinedSnapshot)));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(guest.id)}`,
      { cache: "no-store" },
    );

    const privateLinkRegion = container.querySelector(
      'section[aria-labelledby="private-link-heading"]',
    );
    expect(privateLinkRegion?.querySelector("h2")?.textContent)
      .toBe("Save your private edit link");
    expect(privateLinkRegion?.querySelector("a")?.textContent)
      .toBe("Private edit link");
    expect(radio(OPTION_ONE_ID, "UNANSWERED").closest("fieldset")
      ?.querySelector("legend")?.textContent).toBe("January 1, 2030");
    expect(container.querySelector('form[aria-label="Join appointment"]')).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(finalizedSnapshot));
    await act(async () => source.message('{"revision":3}'));
    expect(container.querySelector('form[aria-label="Join appointment"]')).toBeNull();
    expect(container.querySelector(
      'section[aria-labelledby="private-link-heading"]',
    )).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse(reopenedSnapshot));
    await act(async () => source.message('{"revision":4}'));
    expect(container.querySelector('[aria-label="Saved participant"]')?.textContent)
      .toContain(`Returning as ${guest.displayName}`);
    expect(radio(OPTION_ONE_ID, "UNANSWERED")).toBeInstanceOf(HTMLInputElement);
    expect(container.querySelector('form[aria-label="Join appointment"]')).toBeNull();
  });

  it("strictly ignores malformed and stale revision frames while applying a newer one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(BASE_SNAPSHOT));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    const source = currentEventSource();
    await act(async () => source.open());
    fetchMock.mockClear();

    act(() => {
      source.message("not json");
      source.message("null");
      source.message('{"revision":"2"}');
      source.message('{"revision":2,"extra":true}');
      source.message('{"revision":1}');
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonResponse(snapshotWithResponse(3, "NO")));
    await act(async () => source.message('{"revision":2}'));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);

    fetchMock.mockClear();
    act(() => {
      source.message('{"revision":3}');
      source.message('{"revision":2}');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("coalesces a burst into one in-flight refresh and one queued follow-up", async () => {
    const firstRefresh = deferredResponse();
    const queuedRefresh = deferredResponse();
    fetchMock
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(queuedRefresh.promise);
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    const source = currentEventSource();

    act(() => {
      source.open();
      source.message('{"revision":2}');
      source.message('{"revision":3}');
      source.message('{"revision":3}');
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    await act(async () => firstRefresh.resolve(jsonResponse(snapshotWithResponse(2, "YES"))));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => queuedRefresh.resolve(jsonResponse(snapshotWithResponse(3, "NO"))));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);
  });

  it("keeps the disconnect alert through manual refresh and clears it after reconnect repair", async () => {
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    const source = currentEventSource();

    act(() => source.error());
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Live updates disconnected");
    const refresh = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Refresh");
    if (refresh === undefined) throw new Error("Refresh button not found");

    fetchMock
      .mockResolvedValueOnce(jsonResponse(BASE_SNAPSHOT))
      .mockResolvedValueOnce(jsonResponse(snapshotWithResponse(2, "NO")));
    await act(async () => refresh.click());
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
    expect(container.textContent).toContain("Live updates disconnected");

    await act(async () => source.open());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Live updates disconnected");
    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);
  });

  it("keeps the last snapshot and exposes a failed live refresh", async () => {
    fetchMock.mockRejectedValueOnce(new Error("snapshot offline"));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));

    await act(async () => currentEventSource().open());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("snapshot offline");
    expect(radio(OPTION_ONE_ID, "YES").checked).toBe(true);
  });

  it("waits for participant selection before live refresh and reads the current participant ref", async () => {
    const selectionRefresh = deferredResponse();
    const secondParticipant = { id: SECOND_PARTICIPANT_ID, displayName: "Blair" };
    const multipleParticipants: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      participants: [...BASE_SNAPSHOT.participants, secondParticipant],
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        accessibleParticipants: [
          ...BASE_SNAPSHOT.viewer.accessibleParticipants,
          secondParticipant,
        ],
      },
    };
    const selectedSnapshot: AppointmentSnapshot = {
      ...multipleParticipants,
      viewer: {
        ...multipleParticipants.viewer,
        activeParticipantId: SECOND_PARTICIPANT_ID,
      },
      options: multipleParticipants.options.map((option) => ({
        ...option,
        canDelete: false,
      })),
    };
    fetchMock
      .mockReturnValueOnce(selectionRefresh.promise)
      .mockResolvedValueOnce(jsonResponse(selectedSnapshot));
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={multipleParticipants} />,
    ));
    const selector = container.querySelector("#return-participant");
    if (!(selector instanceof HTMLSelectElement)) throw new Error("Participant selector not found");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Select value setter not found");
      setter.call(selector, SECOND_PARTICIPANT_ID);
      selector.dispatchEvent(new Event("change", { bubbles: true }));
      currentEventSource().open();
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    await act(async () => selectionRefresh.resolve(jsonResponse(selectedSnapshot)));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(SECOND_PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
  });

  it("preserves a pending autosave value over a live snapshot", async () => {
    const pendingSave = deferredResponse();
    fetchMock
      .mockReturnValueOnce(pendingSave.promise)
      .mockResolvedValueOnce(jsonResponse(snapshotWithResponse(2, "YES")));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));

    await act(async () => radio(OPTION_ONE_ID, "NO").click());
    await act(async () => currentEventSource().open());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);
    expect(radio(OPTION_ONE_ID, "NO").closest("fieldset")?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector(`[data-save-status="${OPTION_ONE_ID}"]`)?.textContent)
      .toBe("Saving");

    await act(async () => pendingSave.resolve(success("NO", 3)));
    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);
  });
  it("does not let an optimistic response revision suppress an unseen SSE revision", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(BASE_SNAPSHOT))
      .mockResolvedValueOnce(success("NO", 3))
      .mockResolvedValueOnce(jsonResponse(snapshotWithResponse(3, "NO")));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    const source = currentEventSource();
    await act(async () => source.open());
    await act(async () => radio(OPTION_ONE_ID, "NO").click());

    await act(async () => source.message('{"revision":2}'));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
  });

  it("does not let an optimistic deletion revision suppress an unseen SSE revision", async () => {
    const deletedSnapshot: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      appointment: { ...BASE_SNAPSHOT.appointment, revision: 3 },
      options: BASE_SNAPSHOT.options.filter(({ id }) => id !== OPTION_TWO_ID),
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(BASE_SNAPSHOT))
      .mockResolvedValueOnce(jsonResponse({ revision: 3 }))
      .mockRejectedValueOnce(new Error("snapshot offline"))
      .mockResolvedValueOnce(jsonResponse(deletedSnapshot));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    const source = currentEventSource();
    await act(async () => source.open());
    await act(async () => deleteButton(OPTION_TWO_ID).click());
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => source.message('{"revision":2}'));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
  });

  it("preserves canDelete flags from newer global data for a stale snapshot of the same actor", async () => {
    const staleSameActorSnapshot: AppointmentSnapshot = {
      ...snapshotWithResponse(2, "NO"),
      options: snapshotWithResponse(2, "NO").options.map((option) => ({
        ...option,
        canDelete: false,
      })),
    };
    fetchMock
      .mockResolvedValueOnce(success("NO", 3))
      .mockResolvedValueOnce(jsonResponse(staleSameActorSnapshot));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    await act(async () => radio(OPTION_ONE_ID, "NO").click());

    await act(async () => currentEventSource().open());

    expect(container.querySelector(`[data-delete-option="${OPTION_ONE_ID}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-delete-option="${OPTION_TWO_ID}"]`)).not.toBeNull();
  });

  it("lets a winning manual refresh complete reconnect repair when it supersedes the open refresh", async () => {
    const openRefresh = deferredResponse();
    fetchMock
      .mockReturnValueOnce(openRefresh.promise)
      .mockResolvedValueOnce(jsonResponse(snapshotWithResponse(2, "NO")));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    const source = currentEventSource();
    act(() => source.error());
    act(() => source.open());
    const refresh = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Refresh");
    if (refresh === undefined) throw new Error("Refresh button not found");

    await act(async () => refresh.click());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Live updates disconnected");

    await act(async () => openRefresh.resolve(jsonResponse(BASE_SNAPSHOT)));
    expect(container.textContent).not.toContain("Live updates disconnected");
  });

  it("does not let an open refresh clear a later disconnect error", async () => {
    const openRefresh = deferredResponse();
    fetchMock.mockReturnValueOnce(openRefresh.promise);
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    const source = currentEventSource();
    act(() => source.error());
    act(() => source.open());
    act(() => source.error());

    await act(async () => openRefresh.resolve(jsonResponse(snapshotWithResponse(2, "NO"))));

    expect(container.textContent).toContain("Live updates disconnected");
  });

  it("shows disconnect and snapshot failures together with one Refresh action", async () => {
    fetchMock.mockRejectedValueOnce(new Error("snapshot offline"));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    const source = currentEventSource();
    act(() => source.error());
    const refresh = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Refresh");
    if (refresh === undefined) throw new Error("Refresh button not found");

    await act(async () => refresh.click());

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Live updates disconnected");
    expect(alert?.textContent).toContain("snapshot offline");
    expect(Array.from(alert?.querySelectorAll("button") ?? [])
      .filter((button) => button.textContent === "Refresh")).toHaveLength(1);
  });

});

describe("AppointmentClient participant controls", () => {
  it("disables only one option, announces save states, and applies the returned revision", async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));

    await act(async () => radio(OPTION_ONE_ID, "NO").click());

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/appointments/${PUBLIC_ID}/responses/${OPTION_ONE_ID}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: PARTICIPANT_ID, value: "NO" }),
      },
    );
    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);
    expect(radio(OPTION_ONE_ID, "YES").closest("fieldset")?.hasAttribute("disabled")).toBe(true);
    expect(radio(OPTION_TWO_ID, "YES").closest("fieldset")?.hasAttribute("disabled")).toBe(false);
    expect(container.querySelector(`[data-save-status="${OPTION_ONE_ID}"]`)?.textContent).toBe("Saving");

    await act(async () => pending.resolve(success("NO", 2)));

    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);
    expect(container.querySelector(`[data-save-status="${OPTION_ONE_ID}"]`)?.textContent).toBe("Saved");
    expect(radio(OPTION_ONE_ID, "YES").closest("fieldset")?.hasAttribute("disabled")).toBe(false);
    expect(sumCell(OPTION_ONE_ID)?.textContent).toContain("0 yes · 1 no");
  });

  it("keeps a pending value over a stale incoming snapshot", async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    const onSaved = vi.fn();
    const option = BASE_SNAPSHOT.options[0];
    if (option === undefined) throw new Error("Base snapshot has no options");
    await act(async () => root.render(
      <ResponseControl
        option={option}
        participantId={PARTICIPANT_ID}
        publicId={PUBLIC_ID}
        savedValue="YES"
        onSaved={onSaved}
      />,
    ));

    await act(async () => radio(OPTION_ONE_ID, "NO").click());
    await act(async () => root.render(
      <ResponseControl
        option={{ ...option }}
        participantId={PARTICIPANT_ID}
        publicId={PUBLIC_ID}
        savedValue="YES"
        onSaved={onSaved}
      />,
    ));

    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(success("NO", 2)));
    expect(onSaved).toHaveBeenCalledWith(OPTION_ONE_ID, "NO", 2, PARTICIPANT_ID);
  });

  it("restores the prior value and retries only the failed option", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "Could not save the response." },
      }), { status: 500, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(success("NO", 2));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));

    await act(async () => radio(OPTION_ONE_ID, "NO").click());

    expect(radio(OPTION_ONE_ID, "YES").checked).toBe(true);
    expect(container.textContent).toContain("Could not save the response.");
    const retry = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Retry");
    expect(retry).toBeDefined();

    await act(async () => retry?.click());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(radio(OPTION_ONE_ID, "NO").checked).toBe(true);
    expect(container.querySelector(`[data-save-status="${OPTION_ONE_ID}"]`)?.textContent).toBe("Saved");
  });

  it("renders no response form when the snapshot denies response access", async () => {
    const readOnly: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        activeParticipantId: null,
        permissions: { ...BASE_SNAPSHOT.viewer.permissions, canRespond: false },
      },
    };

    await act(async () => root.render(<AppointmentClient initialSnapshot={readOnly} />));

    expect(container.querySelector('input[name^="response-"]')).toBeNull();
    expect(container.textContent).toContain("Read-only availability");
    expect(container.querySelector("[data-delete-option]")).toBeNull();
  });
  it("blocks participant-bound controls while a participant selection refresh is pending", async () => {
    const pending = deferredResponse();
    const secondParticipant = { id: SECOND_PARTICIPANT_ID, displayName: "Blair" };
    const multipleParticipants: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      participants: [...BASE_SNAPSHOT.participants, secondParticipant],
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        accessibleParticipants: [
          ...BASE_SNAPSHOT.viewer.accessibleParticipants,
          secondParticipant,
        ],
      },
    };
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={multipleParticipants} />,
    ));
    const selector = container.querySelector("#return-participant");
    if (!(selector instanceof HTMLSelectElement)) {
      throw new Error("Participant selector not found");
    }

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Select value setter not found");
      setter.call(selector, SECOND_PARTICIPANT_ID);
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(selector.disabled).toBe(true);
    expect(addOptionToggle()).toBeNull();
    expect(container.querySelector('input[name^="response-"]')).toBeNull();
    expect(container.querySelector("[data-delete-option]")).toBeNull();

    await act(async () => pending.resolve(new Response(JSON.stringify({
      ...multipleParticipants,
      viewer: {
        ...multipleParticipants.viewer,
        activeParticipantId: SECOND_PARTICIPANT_ID,
      },
      options: multipleParticipants.options.map((option) => ({
        ...option,
        canDelete: false,
      })),
    }), { status: 200, headers: { "content-type": "application/json" } })));

    expect(selector.disabled).toBe(false);
    expect(addOptionToggle()).not.toBeNull();
    expect(container.querySelector("[data-delete-option]")).toBeNull();
  });

  it("refreshes the active participant snapshot after a suggestion succeeds", async () => {
    const addedOption = {
      id: "00000000-0000-4000-8000-000000000103",
      kind: "DATE" as const,
      startDate: "2030-01-03",
      creatorParticipantId: PARTICIPANT_ID,
      responses: [{ participantId: PARTICIPANT_ID, value: "YES" as const }],
      yesCount: 1,
      noCount: 0,
      canDelete: true,
    };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        optionId: addedOption.id,
        revision: 2,
      }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...BASE_SNAPSHOT,
        appointment: { ...BASE_SNAPSHOT.appointment, revision: 2 },
        options: [...BASE_SNAPSHOT.options, addedOption],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    openAddOptionPanel();
    const pickableDay = container.querySelector<HTMLButtonElement>(
      "[data-date]:not([disabled])",
    );
    if (pickableDay === null) throw new Error("No selectable day in the picker");

    await act(async () => pickableDay.click());

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
    expect(container.querySelector(
      `tbody th[data-option-id="${addedOption.id}"]`,
    )?.textContent).toBe("January 3, 2030");
    expect(radio(addedOption.id, "YES").checked).toBe(true);
    expect(sumCell(addedOption.id)?.textContent).toContain("1 yes · 0 no");
  });

  it("omits suggestion controls when suggestion permission is denied", async () => {
    const denied: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        permissions: { ...BASE_SNAPSHOT.viewer.permissions, canSuggest: false },
      },
    };

    await act(async () => root.render(<AppointmentClient initialSnapshot={denied} />));

    expect(addOptionToggle()).toBeNull();
    expect(container.textContent).not.toContain("Option limit reached");
  });

  it("shows an option-limit message instead of an active suggestion form", async () => {
    const atLimit: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      appointment: { ...BASE_SNAPSHOT.appointment, optionLimit: BASE_SNAPSHOT.options.length },
    };

    await act(async () => root.render(<AppointmentClient initialSnapshot={atLimit} />));

    expect(addOptionToggle()).toBeNull();
    expect(container.querySelector('[data-suggestion-limit]')?.textContent)
      .toBe("Option limit reached. No more suggestions can be added.");
  });

  it("keeps finalized views without suggestion controls even if permission data is stale", async () => {
    const finalized: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      appointment: {
        ...BASE_SNAPSHOT.appointment,
        status: "FINALIZED",
        finalOptionId: OPTION_ONE_ID,
      },
    };

    await act(async () => root.render(<AppointmentClient initialSnapshot={finalized} />));

    expect(addOptionToggle()).toBeNull();
    expect(container.querySelector("[data-suggestion-limit]")).toBeNull();
    expect(container.querySelector("[data-delete-option]")).toBeNull();
  });

  it("deletes immediately without a token and refreshes the current participant snapshot", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ revision: 2 }))
      .mockResolvedValueOnce(jsonResponse({
        ...BASE_SNAPSHOT,
        appointment: { ...BASE_SNAPSHOT.appointment, revision: 2 },
        options: BASE_SNAPSHOT.options.filter(({ id }) => id !== OPTION_TWO_ID),
      }));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));

    await act(async () => deleteButton(OPTION_TWO_ID).click());

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/appointments/${PUBLIC_ID}/options/${OPTION_TWO_ID}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: PARTICIPANT_ID }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
    expect(container.querySelector(`[data-delete-option="${OPTION_TWO_ID}"]`)).toBeNull();
    expect(container.querySelector(
      `tbody th[data-option-id="${OPTION_TWO_ID}"]`,
    )).toBeNull();
  });
  it("removes a deleted option when a newer local revision wins and refresh fails", async () => {
    const deletion = deferredResponse();
    fetchMock
      .mockReturnValueOnce(deletion.promise)
      .mockResolvedValueOnce(success("NO", 3))
      .mockRejectedValueOnce(new Error("offline"));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));

    await act(async () => deleteButton(OPTION_TWO_ID).click());
    await act(async () => radio(OPTION_ONE_ID, "NO").click());
    await act(async () => deletion.resolve(jsonResponse({ revision: 2 })));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector(`[data-delete-option="${OPTION_TWO_ID}"]`)).toBeNull();
    expect(container.querySelector(
      `tbody th[data-option-id="${OPTION_TWO_ID}"]`,
    )).toBeNull();
    expect(container.textContent).toContain("offline");
  });


  it("opens a focused native dialog naming the option and every current Yes participant", async () => {
    fetchMock.mockResolvedValueOnce(confirmationResponse(
      "DELETE_CONFIRMATION_REQUIRED",
      ["Avery", "Blair"],
      CONFIRMATION_TOKEN,
    ));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));

    await act(async () => deleteButton(OPTION_ONE_ID).click());

    const dialog = deleteDialog();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("January 1, 2030");
    expect(dialog.textContent).toContain("Avery");
    expect(dialog.textContent).toContain("Blair");
    expect(dialog.querySelectorAll("[data-delete-participant]")).toHaveLength(2);
    expect(document.activeElement).toBe(dialog.querySelector("[data-delete-cancel]"));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ participantId: PARTICIPANT_ID }),
    });
  });

  it("confirms with the issued token and removes the dialog after refresh", async () => {
    fetchMock
      .mockResolvedValueOnce(confirmationResponse(
        "DELETE_CONFIRMATION_REQUIRED",
        ["Avery"],
        CONFIRMATION_TOKEN,
      ))
      .mockResolvedValueOnce(jsonResponse({ revision: 2 }))
      .mockResolvedValueOnce(jsonResponse({
        ...BASE_SNAPSHOT,
        appointment: { ...BASE_SNAPSHOT.appointment, revision: 2 },
        options: BASE_SNAPSHOT.options.filter(({ id }) => id !== OPTION_ONE_ID),
      }));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    await act(async () => deleteButton(OPTION_ONE_ID).click());

    await act(async () => {
      const confirm = deleteDialog().querySelector("[data-delete-confirm]");
      if (!(confirm instanceof HTMLButtonElement)) throw new Error("Confirm button not found");
      confirm.click();
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/appointments/${PUBLIC_ID}/options/${OPTION_ONE_ID}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: PARTICIPANT_ID,
          confirmationToken: CONFIRMATION_TOKEN,
        }),
      },
    );
    expect(container.querySelector("[data-delete-dialog]")).toBeNull();
    expect(container.querySelector(`[data-delete-option="${OPTION_ONE_ID}"]`)).toBeNull();
  });

  it("cancels through the button or Escape without sending confirmation", async () => {
    fetchMock
      .mockResolvedValueOnce(confirmationResponse(
        "DELETE_CONFIRMATION_REQUIRED",
        ["Avery"],
        CONFIRMATION_TOKEN,
      ))
      .mockResolvedValueOnce(confirmationResponse(
        "DELETE_CONFIRMATION_REQUIRED",
        ["Avery"],
        CONFIRMATION_TOKEN,
      ));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    const firstTrigger = deleteButton(OPTION_ONE_ID);
    firstTrigger.focus();
    await act(async () => firstTrigger.click());

    act(() => {
      const cancel = deleteDialog().querySelector("[data-delete-cancel]");
      if (!(cancel instanceof HTMLButtonElement)) throw new Error("Cancel button not found");
      cancel.click();
    });
    expect(container.querySelector("[data-delete-dialog]")).toBeNull();
    expect(document.activeElement).toBe(firstTrigger);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const secondTrigger = deleteButton(OPTION_ONE_ID);
    secondTrigger.focus();
    await act(async () => secondTrigger.click());
    act(() => {
      const cancelEvent = new Event("cancel", { cancelable: true });
      const dialog = deleteDialog();
      dialog.dispatchEvent(cancelEvent);
      if (!cancelEvent.defaultPrevented) dialog.close();
    });
    expect(container.querySelector("[data-delete-dialog]")).toBeNull();
    expect(document.activeElement).toBe(secondTrigger);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("replaces stale confirmation details and requires the replacement token", async () => {
    fetchMock
      .mockResolvedValueOnce(confirmationResponse(
        "DELETE_CONFIRMATION_REQUIRED",
        ["Avery"],
        CONFIRMATION_TOKEN,
      ))
      .mockResolvedValueOnce(confirmationResponse(
        "STALE_DELETE_CONFIRMATION",
        ["Avery", "Blair"],
        REPLACEMENT_TOKEN,
      ))
      .mockResolvedValueOnce(jsonResponse({ revision: 2 }))
      .mockResolvedValueOnce(jsonResponse({
        ...BASE_SNAPSHOT,
        appointment: { ...BASE_SNAPSHOT.appointment, revision: 2 },
        options: BASE_SNAPSHOT.options.filter(({ id }) => id !== OPTION_ONE_ID),
      }));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    await act(async () => deleteButton(OPTION_ONE_ID).click());

    await act(async () => {
      const confirm = deleteDialog().querySelector("[data-delete-confirm]");
      if (!(confirm instanceof HTMLButtonElement)) throw new Error("Confirm button not found");
      confirm.click();
    });

    expect(deleteDialog().textContent).toContain("Responses changed");
    expect(deleteDialog().querySelectorAll("[data-delete-participant]")).toHaveLength(2);
    expect(deleteDialog().textContent).toContain("Blair");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      const confirm = deleteDialog().querySelector("[data-delete-confirm]");
      if (!(confirm instanceof HTMLButtonElement)) throw new Error("Confirm button not found");
      confirm.click();
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({
        participantId: PARTICIPANT_ID,
        confirmationToken: REPLACEMENT_TOKEN,
      }),
    });
  });

  it("keeps confirmation open with a useful route failure", async () => {
    fetchMock
      .mockResolvedValueOnce(confirmationResponse(
        "DELETE_CONFIRMATION_REQUIRED",
        ["Avery"],
        CONFIRMATION_TOKEN,
      ))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: "RATE_LIMITED", message: "Try again in a moment." },
      }, 429));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    await act(async () => deleteButton(OPTION_ONE_ID).click());

    await act(async () => {
      const confirm = deleteDialog().querySelector("[data-delete-confirm]");
      if (!(confirm instanceof HTMLButtonElement)) throw new Error("Confirm button not found");
      confirm.click();
    });

    expect(deleteDialog().open).toBe(true);
    expect(deleteDialog().querySelector('[role="alert"]')?.textContent)
      .toBe("Try again in a moment.");
    const confirmAfterFailure = deleteDialog().querySelector("[data-delete-confirm]");
    expect(confirmAfterFailure instanceof HTMLButtonElement && confirmAfterFailure.disabled).toBe(false);
  });

  it("locks confirmation requests and blocks dismissal until the request settles", async () => {
    const pending = deferredResponse();
    fetchMock
      .mockResolvedValueOnce(confirmationResponse(
        "DELETE_CONFIRMATION_REQUIRED",
        ["Avery"],
        CONFIRMATION_TOKEN,
      ))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jsonResponse({
        ...BASE_SNAPSHOT,
        appointment: { ...BASE_SNAPSHOT.appointment, revision: 2 },
        options: BASE_SNAPSHOT.options.filter(({ id }) => id !== OPTION_ONE_ID),
      }));
    await act(async () => root.render(<AppointmentClient initialSnapshot={BASE_SNAPSHOT} />));
    await act(async () => deleteButton(OPTION_ONE_ID).click());
    const confirm = deleteDialog().querySelector("[data-delete-confirm]");
    if (!(confirm instanceof HTMLButtonElement)) throw new Error("Confirm button not found");

    await act(async () => confirm.click());
    confirm.click();
    const cancelEvent = new Event("cancel", { cancelable: true });
    act(() => deleteDialog().dispatchEvent(cancelEvent));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(confirm.disabled).toBe(true);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(deleteDialog().open).toBe(true);

    await act(async () => pending.resolve(jsonResponse({ revision: 2 })));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[data-delete-dialog]")).toBeNull();
  });

  it("waits for participant selection before refreshing a successful deletion", async () => {
    const deletion = deferredResponse();
    const selection = deferredResponse();
    const currentParticipantRefresh = deferredResponse();
    const secondParticipant = { id: SECOND_PARTICIPANT_ID, displayName: "Blair" };
    const multipleParticipants: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      participants: [...BASE_SNAPSHOT.participants, secondParticipant],
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        accessibleParticipants: [
          ...BASE_SNAPSHOT.viewer.accessibleParticipants,
          secondParticipant,
        ],
      },
    };
    const selectedParticipantSnapshot: AppointmentSnapshot = {
      ...multipleParticipants,
      viewer: {
        ...multipleParticipants.viewer,
        activeParticipantId: SECOND_PARTICIPANT_ID,
      },
      options: multipleParticipants.options.map((option) => ({
        ...option,
        canDelete: false,
      })),
    };
    fetchMock
      .mockReturnValueOnce(deletion.promise)
      .mockReturnValueOnce(selection.promise)
      .mockReturnValueOnce(currentParticipantRefresh.promise);
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={multipleParticipants} />,
    ));
    const selector = container.querySelector("#return-participant");
    if (!(selector instanceof HTMLSelectElement)) throw new Error("Participant selector not found");

    await act(async () => deleteButton(OPTION_TWO_ID).click());
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Select value setter not found");
      setter.call(selector, SECOND_PARTICIPANT_ID);
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => deletion.resolve(jsonResponse({ revision: 2 })));

    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => selection.resolve(jsonResponse(selectedParticipantSnapshot)));

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(SECOND_PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
    expect(container.querySelector(`[data-delete-option="${OPTION_TWO_ID}"]`)).toBeNull();
    expect(container.querySelector("[data-delete-option]")).toBeNull();
    expect(selector.value).toBe(SECOND_PARTICIPANT_ID);

    await act(async () => currentParticipantRefresh.resolve(jsonResponse({
      ...selectedParticipantSnapshot,
      appointment: { ...selectedParticipantSnapshot.appointment, revision: 2 },
      options: selectedParticipantSnapshot.options.filter(({ id }) => id !== OPTION_TWO_ID),
    })));
  });

  it("renders deletion only for active options whose snapshot grants canDelete", async () => {
    const selectivelyAllowed: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      options: BASE_SNAPSHOT.options.map((option) => ({
        ...option,
        canDelete: option.id === OPTION_TWO_ID,
      })),
    };
    await act(async () => root.render(<AppointmentClient initialSnapshot={selectivelyAllowed} />));
    expect(container.querySelector(`[data-delete-option="${OPTION_ONE_ID}"]`)).toBeNull();
    expect(container.querySelector(`[data-delete-option="${OPTION_TWO_ID}"]`)).not.toBeNull();

    const finalized: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      appointment: {
        ...BASE_SNAPSHOT.appointment,
        status: "FINALIZED",
        finalOptionId: OPTION_ONE_ID,
      },
    };
    await act(async () => root.render(
      <AppointmentClient key="finalized" initialSnapshot={finalized} />,
    ));
    expect(container.querySelector("[data-delete-option]")).toBeNull();
  });
});

describe("AppointmentClient finalization", () => {
  function managerSnapshot(
    appointment: AppointmentSnapshot["appointment"] = BASE_SNAPSHOT.appointment,
  ): AppointmentSnapshot {
    return {
      ...BASE_SNAPSHOT,
      appointment,
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        kind: "authenticated",
        permissions: {
          ...BASE_SNAPSHOT.viewer.permissions,
          canFinalize: true,
        },
      },
    };
  }

  function finalizeForm(optionId: string): HTMLFormElement {
    const form = container.querySelector(`[data-finalize-form="${optionId}"]`);
    if (!(form instanceof HTMLFormElement)) {
      throw new Error(`Finalize form ${optionId} not found`);
    }
    return form;
  }

  function submitFinalize(optionId: string): void {
    finalizeForm(optionId).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  }

  function finalizedSnapshot(optionId = OPTION_TWO_ID): AppointmentSnapshot {
    const active = managerSnapshot();
    return {
      ...active,
      appointment: {
        ...active.appointment,
        status: "FINALIZED",
        finalOptionId: optionId,
        revision: 2,
      },
      options: active.options.map((option) => ({ ...option, canDelete: false })),
      viewer: {
        ...active.viewer,
        permissions: {
          ...active.viewer.permissions,
          canFinalize: false,
          canRespond: false,
          canSuggest: false,
        },
      },
    };
  }

  it("shows one finalize form per option to an active authenticated manager", async () => {
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={managerSnapshot()} />,
    ));

    const forms = Array.from(
      container.querySelectorAll<HTMLFormElement>("[data-finalize-form]"),
    );
    expect(forms.map((form) => form.getAttribute("data-finalize-form"))).toEqual([
      OPTION_ONE_ID,
      OPTION_TWO_ID,
    ]);
    expect(forms.every((form) => form.getAttribute("aria-label") === "Finalize appointment"))
      .toBe(true);
    for (const form of forms) {
      const submit = form.querySelector('button[type="submit"]');
      expect(submit?.textContent).toBe("Finalize");
      const row = form.closest("tr");
      expect(row?.querySelector("th[data-option-id]")?.getAttribute("data-option-id"))
        .toBe(form.getAttribute("data-finalize-form"));
    }
  });

  const hiddenFinalizationCases: Array<[string, AppointmentSnapshot]> = [
    ["guest", {
      ...BASE_SNAPSHOT,
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        permissions: {
          ...BASE_SNAPSHOT.viewer.permissions,
          canFinalize: true,
        },
      },
    }],
    ["anonymous viewer", {
      ...BASE_SNAPSHOT,
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        kind: "anonymous",
        activeParticipantId: null,
        accessibleParticipants: [],
        permissions: {
          ...BASE_SNAPSHOT.viewer.permissions,
          canFinalize: true,
          canRespond: false,
          canSuggest: false,
        },
      },
    }],
    ["manager without permission", {
      ...BASE_SNAPSHOT,
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        kind: "authenticated",
      },
    }],
    ["finalized manager", managerSnapshot({
      ...BASE_SNAPSHOT.appointment,
      status: "FINALIZED",
      finalOptionId: OPTION_ONE_ID,
    })],
  ];

  it.each(hiddenFinalizationCases)(
    "hides finalization from a %s",
    async (_label, snapshot) => {
      await act(async () => root.render(
        <AppointmentClient initialSnapshot={snapshot} />,
      ));

      expect(container.querySelector("[data-finalize-form]")).toBeNull();
    });

  it("carries no separate option selection: the row identifies the option", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ revision: 2 }));
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={managerSnapshot()} />,
    ));

    expect(container.querySelector('input[name="final-option"]')).toBeNull();
    expect(finalizeForm(OPTION_ONE_ID).querySelector("fieldset")).toBeNull();
    expect(finalizeForm(OPTION_ONE_ID).closest("tr"))
      .not.toBe(finalizeForm(OPTION_TWO_ID).closest("tr"));

    await act(async () => submitFinalize(OPTION_TWO_ID));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/appointments/${PUBLIC_ID}/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId: OPTION_TWO_ID }),
      },
    );
  });

  it("locks duplicate submissions while the exact finalize request is pending", async () => {
    const pending = deferredResponse();
    fetchMock
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jsonResponse(finalizedSnapshot()));
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={managerSnapshot()} />,
    ));
    act(() => {
      submitFinalize(OPTION_TWO_ID);
      submitFinalize(OPTION_TWO_ID);
      submitFinalize(OPTION_ONE_ID);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/appointments/${PUBLIC_ID}/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId: OPTION_TWO_ID }),
      },
    );
    for (const optionId of [OPTION_ONE_ID, OPTION_TWO_ID]) {
      const submit = finalizeForm(optionId).querySelector('button[type="submit"]');
      expect(submit instanceof HTMLButtonElement && submit.disabled).toBe(true);
    }
    expect(finalizeForm(OPTION_TWO_ID).querySelector('button[type="submit"]')?.textContent)
      .toBe("Finalizing…");

    await act(async () => pending.resolve(jsonResponse({ revision: 2 })));
  });

  it("exposes a stable route error and restores the controls after failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "INVALID_FINAL_OPTION",
        message: "Choose an option from this appointment.",
      },
    }, 409));
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={managerSnapshot()} />,
    ));

    await act(async () => submitFinalize(OPTION_ONE_ID));

    expect(finalizeForm(OPTION_ONE_ID).querySelector('[role="alert"]')?.textContent)
      .toBe("Choose an option from this appointment.");
    expect(finalizeForm(OPTION_TWO_ID).querySelector('[role="alert"]')).toBeNull();
    for (const optionId of [OPTION_ONE_ID, OPTION_TWO_ID]) {
      const submit = finalizeForm(optionId).querySelector('button[type="submit"]');
      expect(submit instanceof HTMLButtonElement && submit.disabled).toBe(false);
    }
  });

  it("refreshes the full active participant snapshot and uses finalized rendering", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ revision: 2 }))
      .mockResolvedValueOnce(jsonResponse(finalizedSnapshot()));
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={managerSnapshot()} />,
    ));

    await act(async () => submitFinalize(OPTION_TWO_ID));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
    expect(container.querySelector("[data-finalize-form]")).toBeNull();
    expect(container.querySelector('input[name^="response-"]')).toBeNull();
    expect(addOptionToggle()).toBeNull();
    expect(container.querySelector("[data-delete-option]")).toBeNull();
    expect(container.textContent).toContain("Finalized");
    expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
    expect(container.querySelector(
      `tbody th[data-option-id="${OPTION_TWO_ID}"][data-selected="true"]`,
    )?.textContent).toContain("CHOSEN");
  });
});

describe("AppointmentClient appointment lifecycle controls", () => {
  function managerSnapshot({
    status = "ACTIVE",
    canDeleteAppointment = false,
    canReopen = false,
  }: {
    readonly status?: AppointmentSnapshot["appointment"]["status"];
    readonly canDeleteAppointment?: boolean;
    readonly canReopen?: boolean;
  } = {}): AppointmentSnapshot {
    const finalized = status === "FINALIZED";
    return {
      ...BASE_SNAPSHOT,
      appointment: {
        ...BASE_SNAPSHOT.appointment,
        status,
        finalOptionId: finalized ? OPTION_ONE_ID : null,
        revision: finalized ? 2 : 1,
      },
      options: BASE_SNAPSHOT.options.map((option) => ({
        ...option,
        canDelete: finalized ? false : option.canDelete,
      })),
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        kind: "authenticated",
        permissions: {
          ...BASE_SNAPSHOT.viewer.permissions,
          canDeleteAppointment,
          canFinalize: !finalized,
          canReopen,
          canRespond: !finalized,
          canSuggest: !finalized,
        },
      },
    };
  }

  function reopenButton(): HTMLButtonElement {
    const button = container.querySelector("[data-reopen-appointment]");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Reopen appointment button not found");
    }
    return button;
  }

  async function openManagePanel(): Promise<void> {
    const toggle = container.querySelector("button[aria-controls='manage-panel']");
    if (!(toggle instanceof HTMLButtonElement)) {
      throw new Error("Manage appointment toggle not found");
    }
    if (toggle.getAttribute("aria-expanded") === "true") return;
    await act(async () => toggle.click());
  }

  function appointmentDeleteButton(): HTMLButtonElement {
    const button = container.querySelector("[data-delete-appointment]");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Delete appointment button not found");
    }
    return button;
  }

  function appointmentDeleteDialog(): HTMLDialogElement {
    const dialog = container.querySelector("[data-delete-appointment-dialog]");
    if (!(dialog instanceof HTMLDialogElement)) {
      throw new Error("Delete appointment dialog not found");
    }
    return dialog;
  }

  function confirmationTitleInput(): HTMLTextAreaElement {
    const input = appointmentDeleteDialog().querySelector(
      'textarea[name="appointment-title-confirmation"]',
    );
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error("Appointment title confirmation textarea not found");
    }
    return input;
  }

  async function enterConfirmationTitle(value: string): Promise<void> {
    await act(async () => {
      const input = confirmationTitleInput();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Textarea value setter not found");
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("shows active owner deletion without reopen", async () => {
    await act(async () => root.render(
      <AppointmentClient
        initialSnapshot={managerSnapshot({
          canDeleteAppointment: true,
          canReopen: true,
        })}
      />,
    ));

    await openManagePanel();
    expect(appointmentDeleteButton().textContent).toBe("Delete appointment");
    expect(container.querySelector("[data-reopen-appointment]")).toBeNull();
  });

  it("shows finalized co-organizer reopen without owner deletion", async () => {
    await act(async () => root.render(
      <AppointmentClient
        initialSnapshot={managerSnapshot({
          status: "FINALIZED",
          canReopen: true,
        })}
      />,
    ));

    expect(reopenButton().textContent).toBe("Reopen appointment");
    expect(container.querySelector("[data-delete-appointment]")).toBeNull();
  });

  it("shows both finalized lifecycle actions to an owner", async () => {
    await act(async () => root.render(
      <AppointmentClient
        initialSnapshot={managerSnapshot({
          status: "FINALIZED",
          canDeleteAppointment: true,
          canReopen: true,
        })}
      />,
    ));

    expect(reopenButton()).toBeInstanceOf(HTMLButtonElement);
    await openManagePanel();
    expect(appointmentDeleteButton()).toBeInstanceOf(HTMLButtonElement);
  });

  it("hides lifecycle actions when status or authenticated role does not qualify", async () => {
    const untrustedSnapshot: AppointmentSnapshot = {
      ...BASE_SNAPSHOT,
      appointment: {
        ...BASE_SNAPSHOT.appointment,
        status: "FINALIZED",
        finalOptionId: OPTION_ONE_ID,
      },
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        permissions: {
          ...BASE_SNAPSHOT.viewer.permissions,
          canDeleteAppointment: true,
          canReopen: true,
        },
      },
    };
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={untrustedSnapshot} />,
    ));

    expect(container.querySelector("[data-reopen-appointment]")).toBeNull();
    expect(container.querySelector("[data-delete-appointment]")).toBeNull();
  });

  it("locks the exact bodyless reopen request, refreshes fully, and restores writes", async () => {
    const pending = deferredResponse();
    const reopenedBase = managerSnapshot({ canDeleteAppointment: true });
    const reopened: AppointmentSnapshot = {
      ...reopenedBase,
      appointment: { ...reopenedBase.appointment, revision: 3 },
    };
    fetchMock
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jsonResponse(reopened));
    await act(async () => root.render(
      <AppointmentClient
        initialSnapshot={managerSnapshot({
          status: "FINALIZED",
          canDeleteAppointment: true,
          canReopen: true,
        })}
      />,
    ));

    const trigger = reopenButton();
    act(() => {
      trigger.click();
      trigger.click();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/appointments/${PUBLIC_ID}/reopen`,
      { method: "POST" },
    );
    expect(trigger.disabled).toBe(true);

    await act(async () => pending.resolve(jsonResponse({ revision: 3 })));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/appointments/${PUBLIC_ID}/snapshot?participantId=${encodeURIComponent(PARTICIPANT_ID)}`,
      { cache: "no-store" },
    );
    expect(container.querySelector("[data-reopen-appointment]")).toBeNull();
    expect(container.querySelector("[data-finalize-form]")).toBeInstanceOf(HTMLFormElement);
    expect(container.querySelector('input[name^="response-"]')).toBeInstanceOf(HTMLInputElement);
    expect(addOptionToggle()).toBeInstanceOf(HTMLButtonElement);
  });

  it("keeps finalized controls stable and useful after a reopen route failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "FORBIDDEN",
        message: "You no longer manage this appointment.",
      },
    }, 403));
    await act(async () => root.render(
      <AppointmentClient
        initialSnapshot={managerSnapshot({
          status: "FINALIZED",
          canReopen: true,
        })}
      />,
    ));

    await act(async () => reopenButton().click());

    expect(container.querySelector('[data-reopen-panel] [role="alert"]')?.textContent)
      .toBe("You no longer manage this appointment.");
    expect(reopenButton().disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requires the exact current title before sending the exact deletion request", async () => {
    window.localStorage.setItem(
      activeParticipantStorageKey(PUBLIC_ID),
      PARTICIPANT_ID,
    );
    const otherStorageKey = activeParticipantStorageKey("zyxwvutsrqponmlkjihgfedc");
    window.localStorage.setItem(otherStorageKey, SECOND_PARTICIPANT_ID);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => root.render(
      <AppointmentClient
        initialSnapshot={managerSnapshot({ canDeleteAppointment: true })}
      />,
    ));

    await openManagePanel();
    await act(async () => appointmentDeleteButton().click());
    const dialog = appointmentDeleteDialog();
    const input = confirmationTitleInput();
    const confirm = dialog.querySelector("[data-confirm-delete-appointment]");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(input.labels?.[0]?.textContent).toContain('Enter "Planning"');
    expect(confirm instanceof HTMLButtonElement && confirm.disabled).toBe(true);

    await enterConfirmationTitle("planning");
    expect(confirm instanceof HTMLButtonElement && confirm.disabled).toBe(true);
    await enterConfirmationTitle("Planning");
    expect(confirm instanceof HTMLButtonElement && confirm.disabled).toBe(false);

    await act(async () => {
      if (!(confirm instanceof HTMLButtonElement)) {
        throw new Error("Appointment delete confirmation button not found");
      }
      confirm.click();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/appointments/${PUBLIC_ID}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Planning" }),
      },
    );
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBeNull();
    expect(window.localStorage.getItem(otherStorageKey)).toBe(SECOND_PARTICIPANT_ID);
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("preserves multiline titles in confirmation and sends the exact stored title", async () => {
    const title = "Planning\r\nReview";
    const base = managerSnapshot({ canDeleteAppointment: true });
    const snapshot: AppointmentSnapshot = {
      ...base,
      appointment: { ...base.appointment, title },
    };
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={snapshot} />,
    ));
    await openManagePanel();
    await act(async () => appointmentDeleteButton().click());
    const confirm = appointmentDeleteDialog().querySelector(
      "[data-confirm-delete-appointment]",
    );

    await enterConfirmationTitle("Planning\nReview");
    expect(confirmationTitleInput().value).toBe("Planning\nReview");
    expect(confirm instanceof HTMLButtonElement && confirm.disabled).toBe(false);
    await act(async () => {
      if (!(confirm instanceof HTMLButtonElement)) {
        throw new Error("Appointment delete confirmation button not found");
      }
      confirm.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/appointments/${PUBLIC_ID}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
  });

  it("keeps the deleted participant key cleared through a route-transition rerender", async () => {
    const snapshot = managerSnapshot({ canDeleteAppointment: true });
    const deletedStorageKey = activeParticipantStorageKey(PUBLIC_ID);
    const otherStorageKey = activeParticipantStorageKey("zyxwvutsrqponmlkjihgfedc");
    window.localStorage.setItem(deletedStorageKey, PARTICIPANT_ID);
    window.localStorage.setItem(otherStorageKey, SECOND_PARTICIPANT_ID);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={snapshot} />,
    ));
    await openManagePanel();
    await act(async () => appointmentDeleteButton().click());
    await enterConfirmationTitle("Planning");

    await act(async () => {
      const confirm = appointmentDeleteDialog().querySelector(
        "[data-confirm-delete-appointment]",
      );
      if (!(confirm instanceof HTMLButtonElement)) {
        throw new Error("Appointment delete confirmation button not found");
      }
      confirm.click();
    });
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={snapshot} />,
    ));

    expect(window.localStorage.getItem(deletedStorageKey)).toBeNull();
    expect(window.localStorage.getItem(otherStorageKey)).toBe(SECOND_PARTICIPANT_ID);
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("invalidates an in-flight participant refresh before deletion cleanup", async () => {
    const base = managerSnapshot({ canDeleteAppointment: true });
    const snapshot: AppointmentSnapshot = {
      ...base,
      participants: [
        ...base.participants,
        { id: SECOND_PARTICIPANT_ID, displayName: "Blair" },
      ],
      viewer: {
        ...base.viewer,
        accessibleParticipants: [
          ...base.viewer.accessibleParticipants,
          { id: SECOND_PARTICIPANT_ID, displayName: "Blair" },
        ],
      },
    };
    const switchedSnapshot: AppointmentSnapshot = {
      ...snapshot,
      viewer: {
        ...snapshot.viewer,
        activeParticipantId: SECOND_PARTICIPANT_ID,
      },
    };
    const deletedStorageKey = activeParticipantStorageKey(PUBLIC_ID);
    const otherStorageKey = activeParticipantStorageKey("zyxwvutsrqponmlkjihgfedc");
    window.localStorage.setItem(deletedStorageKey, PARTICIPANT_ID);
    window.localStorage.setItem(otherStorageKey, SECOND_PARTICIPANT_ID);
    const pendingSelection = deferredResponse();
    fetchMock
      .mockReturnValueOnce(pendingSelection.promise)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={snapshot} />,
    ));

    const selector = container.querySelector("#return-participant");
    if (!(selector instanceof HTMLSelectElement)) {
      throw new Error("Participant selector not found");
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Select value setter not found");
      setter.call(selector, SECOND_PARTICIPANT_ID);
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await openManagePanel();
    await act(async () => appointmentDeleteButton().click());
    await enterConfirmationTitle("Planning");
    await act(async () => {
      const confirm = appointmentDeleteDialog().querySelector(
        "[data-confirm-delete-appointment]",
      );
      if (!(confirm instanceof HTMLButtonElement)) {
        throw new Error("Appointment delete confirmation button not found");
      }
      confirm.click();
    });

    await act(async () => pendingSelection.resolve(jsonResponse(switchedSnapshot)));
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={snapshot} />,
    ));

    expect(window.localStorage.getItem(deletedStorageKey)).toBeNull();
    expect(window.localStorage.getItem(otherStorageKey)).toBe(SECOND_PARTICIPANT_ID);
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("locks duplicate deletion, preserves exact input, and exposes stable failures", async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(
      <AppointmentClient
        initialSnapshot={managerSnapshot({ canDeleteAppointment: true })}
      />,
    ));
    await openManagePanel();
    await act(async () => appointmentDeleteButton().click());
    await enterConfirmationTitle("Planning");
    const dialog = appointmentDeleteDialog();
    const confirm = dialog.querySelector("[data-confirm-delete-appointment]");
    const cancel = dialog.querySelector("[data-cancel-delete-appointment]");

    act(() => {
      if (!(confirm instanceof HTMLButtonElement)) {
        throw new Error("Appointment delete confirmation button not found");
      }
      confirm.click();
      confirm.click();
    });
    const lockedCancelEvent = new Event("cancel", { cancelable: true });
    act(() => dialog.dispatchEvent(lockedCancelEvent));

    expect(lockedCancelEvent.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(confirm instanceof HTMLButtonElement && confirm.disabled).toBe(true);
    expect(cancel instanceof HTMLButtonElement && cancel.disabled).toBe(true);

    await act(async () => pending.resolve(jsonResponse({
      error: {
        code: "TITLE_CONFIRMATION_MISMATCH",
        message: "Enter the exact appointment title to confirm deletion.",
      },
    }, 400)));

    expect(appointmentDeleteDialog().querySelector('[role="alert"]')?.textContent)
      .toBe("Enter the exact appointment title to confirm deletion.");
    expect(confirmationTitleInput().value).toBe("Planning");
    expect(confirm instanceof HTMLButtonElement && confirm.disabled).toBe(false);
    expect(cancel instanceof HTMLButtonElement && cancel.disabled).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it("cancels through the button or Escape and restores trigger focus", async () => {
    await act(async () => root.render(
      <AppointmentClient
        initialSnapshot={managerSnapshot({ canDeleteAppointment: true })}
      />,
    ));
    await openManagePanel();
    const firstTrigger = appointmentDeleteButton();
    firstTrigger.focus();
    await act(async () => firstTrigger.click());
    expect(document.activeElement).toBe(confirmationTitleInput());

    act(() => {
      const cancel = appointmentDeleteDialog().querySelector(
        "[data-cancel-delete-appointment]",
      );
      if (!(cancel instanceof HTMLButtonElement)) {
        throw new Error("Appointment delete cancel button not found");
      }
      cancel.click();
    });
    expect(container.querySelector("[data-delete-appointment-dialog]")).toBeNull();
    expect(document.activeElement).toBe(firstTrigger);

    const secondTrigger = appointmentDeleteButton();
    secondTrigger.focus();
    await act(async () => secondTrigger.click());
    act(() => {
      const cancelEvent = new Event("cancel", { cancelable: true });
      const dialog = appointmentDeleteDialog();
      dialog.dispatchEvent(cancelEvent);
      if (!cancelEvent.defaultPrevented) dialog.close();
    });
    expect(container.querySelector("[data-delete-appointment-dialog]")).toBeNull();
    expect(document.activeElement).toBe(secondTrigger);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AppointmentClient detail editing", () => {
  function editorSnapshot(
    canEditAppointment: boolean,
    overrides: Partial<AppointmentSnapshot["appointment"]> = {},
  ): AppointmentSnapshot {
    return {
      ...BASE_SNAPSHOT,
      appointment: { ...BASE_SNAPSHOT.appointment, ...overrides },
      viewer: {
        ...BASE_SNAPSHOT.viewer,
        kind: "authenticated",
        permissions: {
          ...BASE_SNAPSHOT.viewer.permissions,
          canEditAppointment,
        },
      },
    };
  }

  function titleEditButton(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>("h1 button");
  }

  function titleInput(): HTMLInputElement {
    const input = container.querySelector('input[aria-label="Appointment title"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Title input not found");
    return input;
  }

  function descriptionButton(): HTMLButtonElement | null {
    return Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Add a description")) ?? null;
  }

  it("makes the heading and description editable for an active manager", async () => {
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={editorSnapshot(true)} />,
    ));

    expect(titleEditButton()).not.toBeNull();
    expect(descriptionButton()).not.toBeNull();
    expect(container.querySelector("h1")?.textContent).toContain("Planning");
  });

  it("leaves the heading as plain text for a guest", async () => {
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={BASE_SNAPSHOT} />,
    ));

    expect(titleEditButton()).toBeNull();
    expect(descriptionButton()).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Planning");
  });

  it("leaves the heading as plain text once the appointment is finalized", async () => {
    await act(async () => root.render(
      <AppointmentClient
        initialSnapshot={editorSnapshot(false, {
          status: "FINALIZED",
          finalOptionId: OPTION_ONE_ID,
          revision: 2,
        })}
      />,
    ));

    expect(titleEditButton()).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Planning");
  });

  it("folds a rename and its revision into the rendered snapshot", async () => {
    await act(async () => root.render(
      <AppointmentClient initialSnapshot={editorSnapshot(true)} />,
    ));
    fetchMock.mockResolvedValueOnce(jsonResponse({ revision: 4 }));

    const button = titleEditButton();
    if (button === null) throw new Error("Title edit button not found");
    await act(async () => button.click());
    await act(async () => {
      const input = titleInput();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("Input value setter not found");
      setter.call(input, "Renamed planning");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      titleInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/appointments/${PUBLIC_ID}`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"title":"Renamed planning"}');
    expect(titleEditButton()?.textContent).toContain("Renamed planning");

    // A snapshot older than the rename must not roll it back.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ...editorSnapshot(true),
      appointment: { ...editorSnapshot(true).appointment, revision: 3 },
    }));
    await act(async () => currentEventSource().message(JSON.stringify({ revision: 3 })));

    expect(titleEditButton()?.textContent).toContain("Renamed planning");
  });
});
