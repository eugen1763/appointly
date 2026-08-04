// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { signOutRequest } = vi.hoisted(() => ({ signOutRequest: vi.fn() }));

vi.mock("../../lib/auth-client", () => ({
  authClient: { signOut: signOutRequest },
}));

import { SignOutButton } from "./SignOutButton";

interface RenderedButton {
  readonly container: HTMLDivElement;
  readonly root: Root;
  readonly button: HTMLButtonElement;
  readonly navigate: ReturnType<typeof vi.fn>;
}

const renderedRoots: RenderedButton[] = [];

async function renderButton(): Promise<RenderedButton> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const navigate = vi.fn();
  await act(async () => root.render(<SignOutButton navigate={navigate} />));
  const button = container.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Sign-out button was not rendered");
  const rendered = { container, root, button, navigate };
  renderedRoots.push(rendered);
  return rendered;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  signOutRequest.mockReset();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const rendered of renderedRoots.splice(0)) {
    act(() => rendered.root.unmount());
    rendered.container.remove();
  }
});

describe("SignOutButton", () => {
  it("sends one sign-out request whose success handler navigates home", async () => {
    signOutRequest.mockResolvedValue({ data: { success: true }, error: null });
    const { button, navigate } = await renderButton();

    expect(button.textContent).toBe("Sign out");

    await click(button);

    expect(signOutRequest).toHaveBeenCalledOnce();
    const request = signOutRequest.mock.calls[0][0];
    expect(typeof request.fetchOptions.onSuccess).toBe("function");
    expect(navigate).not.toHaveBeenCalled();

    request.fetchOptions.onSuccess();

    expect(navigate).toHaveBeenCalledWith("/");
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Signing out…");
  });

  it("reports the failure and stays available for retry when the request rejects", async () => {
    signOutRequest
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ data: { success: true }, error: null });
    const { button, container, navigate } = await renderButton();

    await click(button);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Sign-out did not complete. Check your connection and try again.",
    );
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Sign out");
    expect(navigate).not.toHaveBeenCalled();

    await click(button);

    expect(signOutRequest).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("reports the same failure when Better Auth returns an error", async () => {
    signOutRequest.mockResolvedValue({
      data: null,
      error: { message: "session unavailable", status: 500, statusText: "Error" },
    });
    const { button, container, navigate } = await renderButton();

    await click(button);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Sign-out did not complete. Check your connection and try again.",
    );
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Sign out");
    expect(navigate).not.toHaveBeenCalled();
  });
});
