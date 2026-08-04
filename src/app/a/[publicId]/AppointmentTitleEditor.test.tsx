// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { AppointmentTitleEditor } from "./AppointmentTitleEditor";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const TITLE = "Quarterly planning";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock;
let onSaved: Mock;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  onSaved = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderEditor(title = TITLE): Promise<void> {
  await act(async () => root.render(
    <AppointmentTitleEditor publicId={PUBLIC_ID} title={title} onSaved={onSaved} />,
  ));
}

function heading(): HTMLHeadingElement {
  const element = container.querySelector("h1");
  if (!(element instanceof HTMLHeadingElement)) throw new Error("No h1 rendered");
  return element;
}

function editButton(): HTMLButtonElement {
  const element = heading().querySelector("button");
  if (!(element instanceof HTMLButtonElement)) throw new Error("No edit button rendered");
  return element;
}

function input(): HTMLInputElement {
  const element = container.querySelector('input[aria-label="Appointment title"]');
  if (!(element instanceof HTMLInputElement)) throw new Error("No title input rendered");
  return element;
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null;
}

/** What a screen reader would announce: aria-hidden decoration removed. */
function accessibleText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return clone.textContent ?? "";
}

async function beginEdit(): Promise<void> {
  await act(async () => editButton().click());
}

async function type(value: string): Promise<void> {
  const field = input();
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter(): Promise<void> {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

async function pressEscape(): Promise<void> {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

/** React delegates onBlur from the bubbling focusout event, not from blur. */
async function blurInput(): Promise<void> {
  await act(async () => {
    input().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("AppointmentTitleEditor", () => {
  it("names the heading with exactly the title, glyph excluded", async () => {
    await renderEditor();

    expect(accessibleText(heading())).toBe(TITLE);
    expect(heading().querySelector("[aria-hidden='true']")?.textContent).toBe("✎");
    expect(heading().children).toHaveLength(1);
  });

  it("describes the button with a hint that lives outside the heading", async () => {
    await renderEditor();

    const hintId = editButton().getAttribute("aria-describedby");
    expect(hintId).toBe("title-edit-hint");
    const hint = container.querySelector(`#${hintId}`);
    expect(hint?.textContent).toBe("Select the title to rename this appointment.");
    expect(heading().contains(hint)).toBe(false);
  });

  it("opens an input holding the current title, focused and selected", async () => {
    await renderEditor();
    await beginEdit();

    expect(input().value).toBe(TITLE);
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(TITLE.length);
    expect(input().maxLength).toBe(120);
  });

  it("commits on Enter with exactly the title in the body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revision: 7 }));
    await renderEditor();
    await beginEdit();
    await type("Renamed planning");
    await pressEnter();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/appointments/${PUBLIC_ID}`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"title":"Renamed planning"}');
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(7, "Renamed planning");
    // The idle label follows the `title` prop; folding it back is the parent's job.
    expect(container.querySelector('input[aria-label="Appointment title"]')).toBeNull();
    expect(editButton()).not.toBeNull();
  });

  it("commits on blur when the text changed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revision: 4 }));
    await renderEditor();
    await beginEdit();
    await type("Blur commit");
    await blurInput();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(4, "Blur commit");
  });

  it("sends nothing when the text is unchanged", async () => {
    await renderEditor();
    await beginEdit();
    await pressEnter();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(accessibleText(editButton())).toBe(TITLE);

    await beginEdit();
    await blurInput();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels on Escape without sending anything", async () => {
    await renderEditor();
    await beginEdit();
    await type("Abandoned");
    await pressEscape();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(accessibleText(editButton())).toBe(TITLE);
  });

  it("refuses a blank title inline and sends nothing", async () => {
    await renderEditor();
    await beginEdit();
    await type("   ");
    await pressEnter();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertText()).toBe("Title must contain 1 to 120 characters");
    expect(container.querySelector('input[aria-label="Appointment title"]')).not.toBeNull();
  });

  it("keeps the edit open and shows the server message when the save fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      error: {
        code: "APPOINTMENT_FINALIZED",
        message: "Reopen the appointment before changing appointment details.",
      },
    }, 409));
    await renderEditor();
    await beginEdit();
    await type("Late rename");
    await pressEnter();

    expect(alertText()).toBe("Reopen the appointment before changing appointment details.");
    expect(input().value).toBe("Late rename");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("reports an unparseable error body as a generic failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "TEAPOT" } }, 500));
    await renderEditor();
    await beginEdit();
    await type("Broken");
    await pressEnter();

    expect(alertText()).toBe("Could not save the change. Try again.");
  });

  it("blocks a second submit while the first is in flight", async () => {
    const deferred = deferredResponse();
    fetchMock.mockReturnValue(deferred.promise);
    await renderEditor();
    await beginEdit();
    await type("Locked");
    await pressEnter();

    expect(input().disabled).toBe(true);
    await pressEnter();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(jsonResponse({ revision: 9 }));
      await deferred.promise;
    });
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(9, "Locked");
  });
});

describe("AppointmentTitleEditor after a cancelled edit", () => {
  /*
   * Escape unmounts the input. Chromium then fires focusout; Firefox, WebKit and
   * jsdom fire nothing. The cancel flag must not survive into the next edit, or the
   * first commit of that session is dropped with no request and no error.
   */
  it("still commits the next rename after Escape", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revision: 12 }));
    await renderEditor();

    await beginEdit();
    await type("Abandoned");
    await pressEscape();
    expect(fetchMock).not.toHaveBeenCalled();

    await beginEdit();
    await type("Renamed after escape");
    await pressEnter();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"title":"Renamed after escape"}');
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(12, "Renamed after escape");
  });

  it("still commits on blur after Escape", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revision: 13 }));
    await renderEditor();

    await beginEdit();
    await pressEscape();
    await beginEdit();
    await type("Renamed by blur after escape");
    await blurInput();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(13, "Renamed by blur after escape");
  });
});
