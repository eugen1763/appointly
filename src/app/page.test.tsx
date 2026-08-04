import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("starts Google sign-in from the hero instead of linking to the sign-in page", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toMatch(/<button[^>]*>Sign in with Google<\/button>/);
    expect(markup).not.toMatch(/<a[^>]*>Sign in with Google<\/a>/);
  });

  it("keeps the sign-in page reachable from the topbar", () => {
    const markup = renderToStaticMarkup(<Home />);

    expect(markup).toContain('href="/sign-in?returnTo=%2Fdashboard"');
  });
});
