// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryLocalStorage } from "./browser-storage-test-support";

import {
  activeParticipantStorageKey,
  clearActiveParticipantId,
  readActiveParticipantId,
  storeActiveParticipantId,
} from "./guest-selection-storage";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000121";
const OTHER_PARTICIPANT_ID = "00000000-0000-4000-8000-000000000122";

beforeEach(() => installMemoryLocalStorage());

describe("guest participant selection storage", () => {
  it("scopes the non-secret participant ID to one public appointment", () => {
    storeActiveParticipantId(PUBLIC_ID, PARTICIPANT_ID);
    storeActiveParticipantId(OTHER_PUBLIC_ID, OTHER_PARTICIPANT_ID);

    expect(window.localStorage).toHaveLength(2);
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBe(PARTICIPANT_ID);
    expect(readActiveParticipantId(PUBLIC_ID, [PARTICIPANT_ID])).toBe(PARTICIPANT_ID);
    expect(readActiveParticipantId(OTHER_PUBLIC_ID, [OTHER_PARTICIPANT_ID]))
      .toBe(OTHER_PARTICIPANT_ID);
  });

  it("clears and ignores a stored ID outside the current linked set", () => {
    window.localStorage.setItem(activeParticipantStorageKey(PUBLIC_ID), OTHER_PARTICIPANT_ID);

    expect(readActiveParticipantId(PUBLIC_ID, [PARTICIPANT_ID])).toBeNull();
    expect(window.localStorage.getItem(activeParticipantStorageKey(PUBLIC_ID))).toBeNull();
  });

  it("can clear one appointment without changing another", () => {
    storeActiveParticipantId(PUBLIC_ID, PARTICIPANT_ID);
    storeActiveParticipantId(OTHER_PUBLIC_ID, OTHER_PARTICIPANT_ID);

    clearActiveParticipantId(PUBLIC_ID);

    expect(readActiveParticipantId(PUBLIC_ID, [PARTICIPANT_ID])).toBeNull();
    expect(readActiveParticipantId(OTHER_PUBLIC_ID, [OTHER_PARTICIPANT_ID]))
      .toBe(OTHER_PARTICIPANT_ID);
  });

  it("fails closed when browser storage is unavailable", () => {
    const unavailable: Storage = {
      get length(): number { throw new DOMException("blocked", "SecurityError"); },
      clear() { throw new DOMException("blocked", "SecurityError"); },
      getItem() { throw new DOMException("blocked", "SecurityError"); },
      key() { throw new DOMException("blocked", "SecurityError"); },
      removeItem() { throw new DOMException("blocked", "SecurityError"); },
      setItem() { throw new DOMException("blocked", "SecurityError"); },
    };

    expect(() => storeActiveParticipantId(PUBLIC_ID, PARTICIPANT_ID, unavailable)).not.toThrow();
    expect(readActiveParticipantId(PUBLIC_ID, [PARTICIPANT_ID], unavailable)).toBeNull();
    expect(() => clearActiveParticipantId(PUBLIC_ID, unavailable)).not.toThrow();
  });
});
