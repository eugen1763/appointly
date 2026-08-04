// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { socialSignIn } = vi.hoisted(() => ({ socialSignIn: vi.fn() }));

vi.mock("../../lib/auth-client", () => ({
  authClient: { signIn: { social: socialSignIn } },
}));

import { SignInAction } from "./SignInAction";

interface RenderedAction {
  readonly container: HTMLDivElement;
  readonly root: Root;
  readonly button: HTMLButtonElement;
}

const renderedRoots: RenderedAction[] = [];

async function renderAction(returnTo: string): Promise<RenderedAction> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<SignInAction returnTo={returnTo} />));
  const button = container.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Sign-in button was not rendered");
  const rendered = { container, root, button };
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
  socialSignIn.mockReset();
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

describe("SignInAction", () => {
  it("starts Google sign-in with the safe return path", async () => {
    socialSignIn.mockResolvedValue({ data: { url: "https://accounts.google.com" }, error: null });
    const { button } = await renderAction("/appointments/new");

    await click(button);

    expect(button.textContent).toBe("Continue with Google");
    expect(socialSignIn).toHaveBeenCalledOnce();
    expect(socialSignIn).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/appointments/new",
    });
  });

  it("shows a useful error and keeps the action available for retry", async () => {
    socialSignIn
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ data: { url: "https://accounts.google.com" }, error: null });
    const { button, container } = await renderAction("/dashboard");

    await click(button);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Google sign-in did not start. Check your connection and try again.",
    );
    expect(button.disabled).toBe(false);

    await click(button);

    expect(socialSignIn).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the same retry path when Better Auth returns an error", async () => {
    socialSignIn.mockResolvedValue({
      data: null,
      error: { message: "provider unavailable", status: 503, statusText: "Unavailable" },
    });
    const { button, container } = await renderAction("/dashboard");

    await click(button);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Google sign-in did not start. Check your connection and try again.",
    );
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Continue with Google");
  });
});
