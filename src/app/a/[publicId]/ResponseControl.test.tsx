// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { PublicOption } from "../../../features/appointments/server/snapshot";
import { installMemoryLocalStorage } from "./browser-storage-test-support";
import { ResponseControl, type ResponseValue } from "./ResponseControl";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000001";
const OPTION_ID = "00000000-0000-4000-8000-000000000101";

const OPTION: PublicOption = {
  id: OPTION_ID,
  kind: "DATE",
  startDate: "2030-01-01",
  responses: [{ participantId: PARTICIPANT_ID, value: "YES" }],
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

function success(value: ResponseValue, revision: number): Response {
  return new Response(JSON.stringify({ value, revision }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock;
let onSaved: Mock;

beforeEach(() => {
  installMemoryLocalStorage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  onSaved = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderControl(savedValue: ResponseValue = "YES"): Promise<void> {
  await act(async () => root.render(
    <ResponseControl
      option={OPTION}
      participantId={PARTICIPANT_ID}
      publicId={PUBLIC_ID}
      savedValue={savedValue}
      onSaved={onSaved}
    />,
  ));
}

function radio(value: "YES" | "NO" | "UNANSWERED"): HTMLInputElement {
  const input = container.querySelector(
    `input[name="response-${OPTION_ID}"][value="${value}"]`,
  );
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Radio ${value} not found`);
  }
  return input;
}

function saveStatus(): string {
  return container.querySelector(`[data-save-status="${OPTION_ID}"]`)?.textContent ?? "";
}

describe("ResponseControl", () => {
  it("names one radio group per option and reflects the saved value", async () => {
    await renderControl();

    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(`input[name="response-${OPTION_ID}"]`),
    );
    expect(inputs.map((input) => input.value)).toEqual(["YES", "NO", "UNANSWERED"]);
    expect(inputs.map((input) => input.id)).toEqual([
      `response-${OPTION_ID}-yes`,
      `response-${OPTION_ID}-no`,
      `response-${OPTION_ID}-unanswered`,
    ]);
    expect(inputs.map((input) => input.checked)).toEqual([true, false, false]);
    expect(inputs.every((input) => input.type === "radio")).toBe(true);
  });

  it("labels each radio with visually hidden text beside an aria-hidden mark", async () => {
    await renderControl(null);

    for (const [value, label] of [
      ["YES", "Yes"],
      ["NO", "No"],
      ["UNANSWERED", "Unanswered"],
    ] as const) {
      const input = radio(value);
      const face = input.nextElementSibling;
      const text = face?.nextElementSibling;
      expect(face?.getAttribute("aria-hidden")).toBe("true");
      expect(face?.querySelector("span")).not.toBeNull();
      expect(text?.textContent).toBe(label);
      expect(input.labels?.[0]?.textContent).toBe(label);
    }
    expect(radio("UNANSWERED").checked).toBe(true);
  });

  it("keeps the option label as the group name in a visually hidden legend", async () => {
    await renderControl();

    const fieldset = radio("YES").closest("fieldset");
    expect(fieldset?.querySelector("legend")?.textContent).toBe("January 1, 2030");
    expect(fieldset?.hasAttribute("disabled")).toBe(false);
  });

  it("announces Saving then Saved and reports the revision exactly once", async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    await renderControl();

    await act(async () => radio("NO").click());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/appointments/${PUBLIC_ID}/responses/${OPTION_ID}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: PARTICIPANT_ID, value: "NO" }),
      },
    );
    expect(saveStatus()).toBe("Saving");
    expect(radio("NO").closest("fieldset")?.hasAttribute("disabled")).toBe(true);
    expect(radio("NO").checked).toBe(true);

    await act(async () => pending.resolve(success("NO", 2)));

    expect(saveStatus()).toBe("Saved");
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith(OPTION_ID, "NO", 2, PARTICIPANT_ID);
    expect(radio("NO").closest("fieldset")?.hasAttribute("disabled")).toBe(false);
  });

  it("rolls back to the saved value and offers a retry after a failure", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "Could not save the response." },
      }), { status: 500, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(success("NO", 2));
    await renderControl();

    await act(async () => radio("NO").click());

    expect(radio("YES").checked).toBe(true);
    expect(saveStatus()).toBe("");
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.id).toBe(`response-save-error-${OPTION_ID}`);
    expect(alert?.textContent).toContain("Could not save the response.");
    expect(radio("YES").closest("fieldset")?.getAttribute("aria-describedby"))
      .toBe(`response-save-error-${OPTION_ID}`);
    expect(onSaved).not.toHaveBeenCalled();

    const retry = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Retry");
    if (retry === undefined) throw new Error("Retry button not found");
    await act(async () => retry.click());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saveStatus()).toBe("Saved");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith(OPTION_ID, "NO", 2, PARTICIPANT_ID);

    // The owner of the value is the caller: the control shows the saved value it
    // is given once the accepted response has been applied upstream.
    await renderControl("NO");
    expect(radio("NO").checked).toBe(true);
  });

  it("rejects an echoed value the server did not confirm", async () => {
    fetchMock.mockResolvedValueOnce(success("YES", 2));
    await renderControl();

    await act(async () => radio("NO").click());

    expect(onSaved).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Your answer may not have been saved — the reply could not be read. Reload the page to check.");
    expect(radio("YES").checked).toBe(true);
  });

  it("locks out a second change while its own request is in flight", async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise);
    await renderControl();

    // Both picks land before React can disable the fieldset, so this exercises the
    // per-instance in-flight ref rather than the rendered disabled state.
    await act(async () => {
      radio("NO").click();
      radio("UNANSWERED").click();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(radio("NO").checked).toBe(true);

    await act(async () => pending.resolve(success("NO", 2)));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith(OPTION_ID, "NO", 2, PARTICIPANT_ID);
  });

  it("does not send a request when the picked value is already saved", async () => {
    await renderControl();

    await act(async () => radio("YES").click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveStatus()).toBe("");
  });
});
