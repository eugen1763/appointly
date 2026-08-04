import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("is dynamic and returns only the uncached health JSON", async () => {
    // Dynamic loading lets this test prove the route can load without auth or database setup.
    const { GET, dynamic, fetchCache, revalidate } = await import("./route");

    const response = await GET();

    expect(dynamic).toBe("force-dynamic");
    expect(fetchCache).toBe("force-no-store");
    expect(revalidate).toBe(0);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe('{"status":"ok"}');
  });
});
