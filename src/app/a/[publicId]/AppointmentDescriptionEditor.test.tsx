// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { AppointmentDescriptionEditor } from "./AppointmentDescriptionEditor";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const DESCRIPTION = "Bring the roadmap.\n\nWe decide the date this week.";

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

async function renderEditor(description: string | null = DESCRIPTION): Promise<void> {
  await act(async () => root.render(
    <AppointmentDescriptionEditor
      description={description}
      publicId={PUBLIC_ID}
      onSaved={onSaved}
    />,
  ));
}

function idleButton(): HTMLButtonElement {
  const element = container.querySelector("button");
  if (!(element instanceof HTMLButtonElement)) throw new Error("No idle button rendered");
  return element;
}

function textarea(): HTMLTextAreaElement {
  const element = container.querySelector('textarea[aria-label="Appointment description"]');
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("No textarea rendered");
  return element;
}

function button(name: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === name);
  if (element === undefined) throw new Error(`No button named ${name}`);
  return element;
}

function alertText(): string | null {
  return container.querySelector('[role="alert"]')?.textContent ?? null;
}

function accessibleText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return clone.textContent ?? "";
}

async function beginEdit(): Promise<void> {
  await act(async () => idleButton().click());
}

async function type(value: string): Promise<void> {
  const field = textarea();
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function save(): Promise<void> {
  await act(async () => button("Save description").click());
}

describe("AppointmentDescriptionEditor", () => {
  it("offers to add one when there is no description", async () => {
    await renderEditor(null);

    expect(accessibleText(idleButton())).toBe("Add a description");
  });

  it("shows the existing description as the control, glyph excluded", async () => {
    await renderEditor();

    expect(accessibleText(idleButton())).toBe(DESCRIPTION);
    expect(idleButton().querySelector("[aria-hidden='true']")?.textContent).toBe("✎");
  });

  it("opens a textarea holding the current description", async () => {
    await renderEditor();
    await beginEdit();

    expect(textarea().value).toBe(DESCRIPTION);
    expect(textarea().maxLength).toBe(2000);
    expect(document.activeElement).toBe(textarea());
  });

  it("sends the new text on save", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revision: 3 }));
    await renderEditor();
    await beginEdit();
    await type("One line only.");
    await save();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/appointments/${PUBLIC_ID}`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"description":"One line only."}');
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(3, "One line only.");
  });

  it("clears the description to null when the text is blanked", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revision: 5 }));
    await renderEditor();
    await beginEdit();
    await type("   \n  ");
    await save();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"description":null}');
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(5, null);
  });

  it("keeps interior text untouched and only trims the edges", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ revision: 6 }));
    await renderEditor();
    await beginEdit();
    await type("  First.\n\n  Second.  ");
    await save();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"description":"First.\\n\\n  Second."}');
  });

  it("sends nothing when the text is unchanged", async () => {
    await renderEditor();
    await beginEdit();
    await save();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("sends nothing when an absent description is saved still empty", async () => {
    await renderEditor(null);
    await beginEdit();
    await save();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels on Escape and on the Cancel button without sending anything", async () => {
    await renderEditor();
    await beginEdit();
    await type("Abandoned");
    await act(async () => {
      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();

    await beginEdit();
    await type("Abandoned again");
    await act(async () => button("Cancel").click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("keeps the edit open and reports the server message on failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      error: {
        code: "APPOINTMENT_FINALIZED",
        message: "Reopen the appointment before changing appointment details.",
      },
    }, 409));
    await renderEditor();
    await beginEdit();
    await type("Late edit");
    await save();

    expect(alertText()).toBe("Reopen the appointment before changing appointment details.");
    expect(textarea().value).toBe("Late edit");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("names the error from the textarea so it is announced with the field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      error: {
        code: "APPOINTMENT_FINALIZED",
        message: "Reopen the appointment before changing appointment details.",
      },
    }, 409));
    await renderEditor();
    await beginEdit();

    expect(textarea().getAttribute("aria-invalid")).toBe("false");
    expect(textarea().getAttribute("aria-describedby")).toBeNull();

    await type("Late edit");
    await save();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.id).toBe("description-edit-error");
    expect(textarea().getAttribute("aria-invalid")).toBe("true");
    expect(textarea().getAttribute("aria-describedby")).toBe("description-edit-error");
  });
});
