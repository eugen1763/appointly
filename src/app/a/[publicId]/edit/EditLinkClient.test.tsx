// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from "vitest";

import { installMemoryLocalStorage } from "../browser-storage-test-support";
import { activeParticipantStorageKey } from "../guest-selection-storage";

const { replace, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { EditLinkClient } from "./EditLinkClient";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000123";
const EDIT_TOKEN = Buffer.alloc(32, 0x61).toString("base64url");

let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock;
let consoleError: MockInstance;
let consoleLog: MockInstance;

beforeEach(() => {
  installMemoryLocalStorage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  replace.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setEditUrl(fragment = `participant=${PARTICIPANT_ID}&token=${EDIT_TOKEN}`): void {
  window.history.replaceState({}, "", `/a/${PUBLIC_ID}/edit#${fragment}`);
}

async function renderClient(): Promise<void> {
  await act(async () => {
    root.render(<EditLinkClient publicId={PUBLIC_ID} />);
  });
}

describe("EditLinkClient", () => {
  it("clears the full fragment before the exchange settles and posts exactly once", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    setEditUrl();

    await renderClient();

    expect(window.location.href).toBe(`http://localhost/a/${PUBLIC_ID}/edit`);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(`/api/appointments/${PUBLIC_ID}/guest-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: PARTICIPANT_ID, token: EDIT_TOKEN }),
    });
    expect(container.textContent).not.toContain(EDIT_TOKEN);
    expect(JSON.stringify(window.localStorage)).not.toContain(EDIT_TOKEN);

    await act(async () => {
      resolveResponse?.(new Response(JSON.stringify({ participantId: PARTICIPANT_ID }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    });
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBe(PARTICIPANT_ID);
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith(`/a/${PUBLIC_ID}`);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not post again when the client rerenders", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ participantId: PARTICIPANT_ID }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    setEditUrl();

    await renderClient();
    await act(async () => {
      root.render(<EditLinkClient publicId={PUBLIC_ID} />);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing token", `participant=${PARTICIPANT_ID}`],
    ["extra key", `participant=${PARTICIPANT_ID}&token=${EDIT_TOKEN}&next=secret`],
    ["duplicate participant", `participant=${PARTICIPANT_ID}&participant=${PARTICIPANT_ID}&token=${EDIT_TOKEN}`],
    ["empty fragment", ""],
  ])("clears %s fragments without posting and shows one safe state", async (_case, fragment) => {
    setEditUrl(fragment);

    await renderClient();

    expect(window.location.hash).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("This private edit link could not be opened.");
    expect(container.querySelector(`a[href="/a/${PUBLIC_ID}"]`)?.textContent)
      .toContain("Return to appointment");
    expect(container.textContent).not.toContain(EDIT_TOKEN);
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ["fixed API failure", () => new Response(JSON.stringify({
      error: {
        code: "INVALID_EDIT_LINK",
        message: "server detail must not render",
      },
    }), { status: 403, headers: { "content-type": "application/json" } })],
    ["malformed JSON success", () => new Response("{", {
      status: 200,
      headers: { "content-type": "application/json" },
    })],
    ["extra-key success", () => new Response(JSON.stringify({
      participantId: PARTICIPANT_ID,
      extra: EDIT_TOKEN,
    }), { status: 200, headers: { "content-type": "application/json" } })],
  ])("stores nothing and shows the same safe state for %s", async (_case, response) => {
    fetchMock.mockResolvedValue(response());
    setEditUrl();

    await renderClient();

    expect(window.location.hash).toBe("");
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("This private edit link could not be opened.");
    expect(container.textContent).not.toContain("server detail");
    expect(container.textContent).not.toContain(EDIT_TOKEN);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("processes a new private link after an invalid link on the same page", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ participantId: PARTICIPANT_ID }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    setEditUrl("");
    await renderClient();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    await act(async () => {
      setEditUrl();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(window.location.hash).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBe(PARTICIPANT_ID);
    expect(replace).toHaveBeenCalledWith(`/a/${PUBLIC_ID}`);
  });
});
