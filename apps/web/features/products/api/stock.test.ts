import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_STOCK_BATCH_SLUGS, getStockBatch } from "./stock";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Answers every slug in the request URL with quantity = its position + 1. */
function echoStock(url: string | URL | Request) {
  const slugs = new URL(String(url)).searchParams.get("slugs")!.split(",");
  return jsonResponse({
    items: slugs.map((slug, i) => ({
      slug,
      inStock: true,
      quantity: i + 1,
    })),
  });
}

describe("getStockBatch", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks apps/api for all slugs in one call and maps slug to quantity", async () => {
    fetchMock.mockImplementation((url) => Promise.resolve(echoStock(url)));

    const result = await getStockBatch(["lamp", "chair"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:4000/stock?slugs=lamp,chair",
    );
    expect(result).toEqual(
      new Map([
        ["lamp", 1],
        ["chair", 2],
      ]),
    );
  });

  it("never lets the framework cache the answer", async () => {
    fetchMock.mockImplementation((url) => Promise.resolve(echoStock(url)));

    await getStockBatch(["lamp"]);

    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it("URL-encodes each slug", async () => {
    fetchMock.mockImplementation((url) => Promise.resolve(echoStock(url)));

    await getStockBatch(["a b", "c&d"]);

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:4000/stock?slugs=a%20b,c%26d",
    );
  });

  it("makes no request for an empty list (apps/api would answer 400)", async () => {
    const result = await getStockBatch([]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it("collapses duplicate slugs before asking", async () => {
    fetchMock.mockImplementation((url) => Promise.resolve(echoStock(url)));

    await getStockBatch(["lamp", "lamp"]);

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:4000/stock?slugs=lamp",
    );
  });

  it("splits a list over the cap into several calls and merges them", async () => {
    fetchMock.mockImplementation((url) => Promise.resolve(echoStock(url)));
    const slugs = Array.from(
      { length: MAX_STOCK_BATCH_SLUGS * 2 + 1 },
      (_, i) => `p${i}`,
    );

    const result = await getStockBatch(slugs);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(
      ([url]) => new URL(String(url)).searchParams.get("slugs")!.split(",").length,
    );
    expect(sizes).toEqual([MAX_STOCK_BATCH_SLUGS, MAX_STOCK_BATCH_SLUGS, 1]);
    expect(result.size).toBe(slugs.length);
    expect(result.has("p0")).toBe(true);
    expect(result.has(`p${slugs.length - 1}`)).toBe(true);
  });

  it("rejects when apps/api answers an error, instead of returning a partial list", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));

    await expect(getStockBatch(["lamp"])).rejects.toThrow("Failed to load stock");
  });

  it("rejects when any one chunk fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ message: "boom" }, 503));
    const slugs = Array.from(
      { length: MAX_STOCK_BATCH_SLUGS + 1 },
      (_, i) => `p${i}`,
    );

    await expect(getStockBatch(slugs)).rejects.toThrow("Failed to load stock");
  });
});
