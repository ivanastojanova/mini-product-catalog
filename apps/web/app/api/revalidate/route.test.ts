import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTagMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTagMock(...args),
}));

const ENV_KEY = "REVALIDATE_SECRET";
const originalSecret = process.env[ENV_KEY];

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    revalidateTagMock.mockClear();
    process.env[ENV_KEY] = "test-secret";
  });

  afterEach(() => {
    process.env[ENV_KEY] = originalSecret;
  });

  it("rejects requests with no Authorization header", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "malmo-lounge-chair" }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.revalidated).toBe(false);
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong Bearer secret", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-secret",
        },
        body: JSON.stringify({ slug: "malmo-lounge-chair" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("accepts a valid Bearer secret and revalidates the slug + listing tags", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-secret",
        },
        body: JSON.stringify({ slug: "malmo-lounge-chair" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revalidated).toBe(true);
    expect(body.tags).toEqual(
      expect.arrayContaining(["products", "product:malmo-lounge-chair"]),
    );
    expect(revalidateTagMock).toHaveBeenCalledWith("products", { expire: 0 });
    expect(revalidateTagMock).toHaveBeenCalledWith(
      "product:malmo-lounge-chair",
      { expire: 0 },
    );
  });

  it("accepts the x-revalidate-secret header as an alternative to Bearer", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-revalidate-secret": "test-secret",
        },
        body: JSON.stringify({ slug: "malmo-lounge-chair" }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("also revalidates the previous slug's tag when a product is renamed", async () => {
    const { POST } = await import("./route");

    await POST(
      new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-secret",
        },
        body: JSON.stringify({
          slug: "new-slug",
          previousSlug: "old-slug",
        }),
      }),
    );

    expect(revalidateTagMock).toHaveBeenCalledWith("product:new-slug", {
      expire: 0,
    });
    expect(revalidateTagMock).toHaveBeenCalledWith("product:old-slug", {
      expire: 0,
    });
  });

  it("returns 500 when REVALIDATE_SECRET is not configured", async () => {
    delete process.env[ENV_KEY];
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: "malmo-lounge-chair" }),
      }),
    );

    expect(response.status).toBe(500);
  });
});
