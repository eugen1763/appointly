import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TopBar } from "./TopBar";

describe("TopBar", () => {
  it("renders the brand link alone when no links or end content are given", () => {
    const markup = renderToStaticMarkup(<TopBar />);

    expect(markup).toMatch(/<a[^>]*href="\/"[^>]*>Appointly<\/a>/);
    expect(markup).not.toContain("<nav");
  });

  it("renders one navigation link per entry under a named primary navigation", () => {
    const markup = renderToStaticMarkup(
      <TopBar
        links={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/appointments/new", label: "New appointment" },
        ]}
      />,
    );

    expect(markup).toMatch(/<a[^>]*href="\/"[^>]*>Appointly<\/a>/);
    expect(markup).toContain("<nav");
    expect(markup).toContain('aria-label="Primary"');
    expect(markup).toMatch(/<a[^>]*href="\/dashboard"[^>]*>Dashboard<\/a>/);
    expect(markup).toMatch(/<a[^>]*href="\/appointments\/new"[^>]*>New appointment<\/a>/);
  });

  it("omits the navigation when the link list is empty", () => {
    const markup = renderToStaticMarkup(<TopBar links={[]} />);

    expect(markup).toMatch(/<a[^>]*href="\/"[^>]*>Appointly<\/a>/);
    expect(markup).not.toContain("<nav");
  });

  it("renders end content without a navigation", () => {
    const markup = renderToStaticMarkup(
      <TopBar end={<span>Read-only availability</span>} />,
    );

    expect(markup).toContain("<span>Read-only availability</span>");
    expect(markup).not.toContain("<nav");
  });
});
