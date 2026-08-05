import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEnv = vi.hoisted(() => vi.fn());

vi.mock("../lib/env", () => ({ getEnv }));

import Home from "./page";

describe("Home", () => {
  beforeEach(() => getEnv.mockReturnValue({ GOOGLE_AUTH_ENABLED: true }));

  it("starts Google sign-in from the hero instead of linking to the sign-in page", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toMatch(/<button[^>]*>Sign in with Google<\/button>/);
    expect(markup).not.toMatch(/<a[^>]*>Sign in with Google<\/a>/);
  });

  it("keeps the sign-in page reachable from the topbar", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('href="/sign-in?returnTo=%2Fdashboard"');
  });

  it("offers direct creation and hides Google sign-in when login is disabled", () => {
    getEnv.mockReturnValue({ GOOGLE_AUTH_ENABLED: false });

    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('href="/appointments/new"');
    expect(markup).toContain("Create an appointment");
    expect(markup).toContain("shared internal instance");
    expect(markup).not.toContain("Sign in with Google");
    expect(markup).not.toContain("/sign-in");
  });
});
