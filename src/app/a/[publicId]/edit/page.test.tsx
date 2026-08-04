import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./EditLinkClient", () => ({
  EditLinkClient: ({ publicId }: { readonly publicId: string }) => (
    <div data-edit-client={publicId}>Opening private edit link…</div>
  ),
}));

import EditLinkPage, { metadata } from "./page";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const EDIT_TOKEN = Buffer.alloc(32, 0x72).toString("base64url");

describe("private edit-link page", () => {
  it("exports noindex and nofollow metadata", () => {
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false },
    });
  });

  it("renders only the public ID into the client boundary and never reads a token", async () => {
    const element = await EditLinkPage({
      params: Promise.resolve({ publicId: PUBLIC_ID }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain(`data-edit-client="${PUBLIC_ID}"`);
    expect(JSON.stringify(element)).not.toContain(EDIT_TOKEN);
    expect(html).not.toContain(EDIT_TOKEN);
  });
});
