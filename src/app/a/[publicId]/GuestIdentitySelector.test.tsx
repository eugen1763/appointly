// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installMemoryLocalStorage } from "./browser-storage-test-support";
import { GuestIdentitySelector } from "./GuestIdentitySelector";
import { activeParticipantStorageKey } from "./guest-selection-storage";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const AVERY_ID = "00000000-0000-4000-8000-000000000121";
const BLAIR_ID = "00000000-0000-4000-8000-000000000122";
const STALE_ID = "00000000-0000-4000-8000-000000000199";
const AVERY = { participantId: AVERY_ID, displayName: "Avery Guest" };
const BLAIR = { participantId: BLAIR_ID, displayName: "Blair Guest" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  installMemoryLocalStorage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderSelector(linkedParticipants = [AVERY, BLAIR]): Promise<void> {
  await act(async () => {
    root.render(
      <GuestIdentitySelector
        publicId={PUBLIC_ID}
        linkedParticipants={linkedParticipants}
      />,
    );
  });
}

describe("GuestIdentitySelector", () => {
  it("renders nothing when this browser has no linked participant", async () => {
    await renderSelector([]);
    expect(container.textContent).toBe("");
  });

  it("auto-selects and stores the only linked participant", async () => {
    await renderSelector([AVERY]);

    expect(container.textContent).toContain("Returning as Avery Guest");
    expect(container.querySelector("select")).toBeNull();
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBe(AVERY_ID);
  });

  it("offers only linked names and restores a valid stored choice", async () => {
    window.localStorage.setItem(activeParticipantStorageKey(PUBLIC_ID), BLAIR_ID);
    await renderSelector();

    const label = container.querySelector('label[for="return-participant"]');
    const select = container.querySelector("select");
    expect(label?.textContent).toContain("Choose your saved participant");
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect((select as HTMLSelectElement).value).toBe(BLAIR_ID);
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.text))
      .toEqual(["Choose a participant", "Avery Guest", "Blair Guest"]);
  });

  it("clears an unlinked stored choice and requires a fresh linked selection", async () => {
    window.localStorage.setItem(activeParticipantStorageKey(PUBLIC_ID), STALE_ID);
    await renderSelector();

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBeNull();

    await act(async () => {
      select.value = AVERY_ID;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBe(AVERY_ID);
  });

  it("uses a controlled choice and reports changes", async () => {
    const onParticipantChange = vi.fn();
    await act(async () => {
      root.render(
        <GuestIdentitySelector
          publicId={PUBLIC_ID}
          linkedParticipants={[AVERY, BLAIR]}
          activeParticipantId={AVERY_ID}
          onParticipantChange={onParticipantChange}
        />,
      );
    });
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe(AVERY_ID);

    await act(async () => {
      select.value = BLAIR_ID;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onParticipantChange).toHaveBeenCalledWith(BLAIR_ID);
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBe(BLAIR_ID);
  });
});
