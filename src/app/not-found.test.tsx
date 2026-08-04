import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound from "./not-found";

describe("NotFound", () => {
  it("names the page and says what may have happened to the link", () => {
    const markup = renderToStaticMarkup(<NotFound />);

    expect(markup).toMatch(/<h1[^>]*>Page not found<\/h1>/);
    expect(markup).toContain(
      "This link does not point to anything. The appointment may have been deleted, or the address may be incomplete — check the link you received.",
    );
  });

  it("offers a way back to the home page", () => {
    const markup = renderToStaticMarkup(<NotFound />);

    expect(markup).toMatch(/<a[^>]*href="\/"[^>]*>Go to the home page<\/a>/);
  });
});
