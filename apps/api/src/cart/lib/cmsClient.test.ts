import { afterEach, describe, expect, it, vi } from "vitest";
import { getProductsBySlugs, listProductSlugs } from "./cmsClient.js";

function pageResponse(slugs: unknown[], hasNextPage: boolean, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({ docs: slugs.map((slug) => ({ slug })), hasNextPage }),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listProductSlugs", () => {
  it("follows pagination until hasNextPage is false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pageResponse(["a", "b"], true))
      .mockResolvedValueOnce(pageResponse(["c"], false));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listProductSlugs()).toEqual(["a", "b", "c"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("page=1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  it("returns an empty list for an empty catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pageResponse([], false)));
    expect(await listProductSlugs()).toEqual([]);
  });

  it("skips docs without a usable slug", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pageResponse(["a", "", null, 7, "b"], false)));
    expect(await listProductSlugs()).toEqual(["a", "b"]);
  });

  it("throws when the CMS answers with an error, so 'CMS down' is never mistaken for 'no products'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pageResponse([], false, false, 503)));
    await expect(listProductSlugs()).rejects.toThrow(/503/);
  });

  it("throws when the CMS is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(listProductSlugs()).rejects.toThrow("fetch failed");
  });

  it("gives up on a CMS that never stops paginating", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pageResponse(["a"], true)));
    await expect(listProductSlugs()).rejects.toThrow(/exceeded/);
  });
});

describe("getProductsBySlugs", () => {
  const doc = (slug: string, extra: Record<string, unknown> = {}) => ({
    slug,
    title: `Title ${slug}`,
    price: 19.99,
    currency: "EUR",
    ...extra,
  });
  const reply = (docs: unknown[], ok = true, status = 200) =>
    ({ ok, status, json: async () => ({ docs }) }) as Response;

  it("asks for all slugs in one request, with the locale", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply([doc("a"), doc("b")]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getProductsBySlugs(["a", "b", "a"], "de");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("where[slug][in]")).toBe("a,b");
    expect(url.searchParams.get("locale")).toBe("de");
    expect(result.get("a")).toEqual({ slug: "a", title: "Title a", price: 19.99, currency: "EUR" });
    expect([...result.keys()]).toEqual(["a", "b"]);
  });

  it("leaves unknown slugs out of the map (not an error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([doc("a")])));
    const result = await getProductsBySlugs(["a", "ghost"]);
    expect(result.has("a")).toBe(true);
    expect(result.has("ghost")).toBe(false);
  });

  it("makes no request for an empty list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await getProductsBySlugs([])).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses more slugs than one query string should carry", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `p${i}`);
    await expect(getProductsBySlugs(many)).rejects.toThrow(RangeError);
  });

  it("throws on a CMS error, so 'CMS down' is never read as 'no such products'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([], false, 503)));
    await expect(getProductsBySlugs(["a"])).rejects.toThrow(/503/);
  });

  it.each([
    ["a missing price", { price: undefined }],
    ["a string price", { price: "19.99" }],
    ["a negative price", { price: -1 }],
    ["a NaN price", { price: Number.NaN }],
    ["no currency", { currency: "" }],
    ["no title", { title: undefined }],
  ])("throws on a product with %s instead of pricing it wrongly", async (_label, extra) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply([doc("a", extra)])));
    await expect(getProductsBySlugs(["a"])).rejects.toThrow(/unusable product/);
  });
});
