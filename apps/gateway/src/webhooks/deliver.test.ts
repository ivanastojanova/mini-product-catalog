import { createHmac } from "node:crypto";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { insertIntent, memoryDb } from "../testing.js";
import { settleIntent } from "../events/lib/events.js";
import { deliverEvent } from "./deliver.js";

const URL_ = "http://api.test/webhooks/payments";
const SECRET = "whsec_test_secret";
const NOW = 1767000000;

let sqlite: Database.Database;
let eventId: string;

beforeEach(() => {
  sqlite = memoryDb();
  const result = settleIntent(sqlite, insertIntent(sqlite), "succeed", NOW);
  if (result.outcome !== "settled") throw new Error("setup");
  eventId = result.eventId;
});

const fetchReturning = (status: number) => vi.fn(async () => new Response("{}", { status }));
const options = (fetchImpl: unknown) => ({
  webhookUrl: URL_,
  secret: SECRET,
  now: () => NOW,
  fetchImpl: fetchImpl as typeof fetch,
});
const attempts = () =>
  sqlite.prepare("SELECT delivery_attempts, delivered_at FROM events WHERE id = ?").get(eventId) as {
    delivery_attempts: number;
    delivered_at: number | null;
  };
const stored = () => (sqlite.prepare("SELECT payload FROM events WHERE id = ?").get(eventId) as { payload: string }).payload;

describe("deliverEvent", () => {
  it("POSTs the stored payload byte for byte, signed over exactly those bytes", async () => {
    const fetchImpl = fetchReturning(200);
    await deliverEvent(sqlite, eventId, options(fetchImpl));

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(stored());

    const header = (init.headers as Record<string, string>)["gateway-signature"];
    const expected = createHmac("sha256", SECRET).update(`${NOW}.${stored()}`).digest("hex");
    expect(header).toBe(`t=${NOW},v1=${expected}`);
  });

  it("records a successful delivery", async () => {
    const result = await deliverEvent(sqlite, eventId, options(fetchReturning(200)));

    expect(result).toEqual({ delivered: true, status: 200 });
    expect(attempts().delivery_attempts).toBe(1);
    expect(attempts().delivered_at).not.toBeNull();
  });

  it.each([400, 500, 503])("a %s answer is not delivered: counted, never throws", async (status) => {
    const result = await deliverEvent(sqlite, eventId, options(fetchReturning(status)));

    expect(result).toEqual({ delivered: false, status });
    expect(attempts()).toEqual({ delivery_attempts: 1, delivered_at: null });
  });

  it("a network failure is recorded, not thrown", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await deliverEvent(sqlite, eventId, options(fetchImpl));

    expect(result).toEqual({ delivered: false, error: "fetch failed" });
    expect(attempts()).toEqual({ delivery_attempts: 1, delivered_at: null });
  });

  it("re-sending the same event keeps its id and body but takes a fresh timestamp and signature", async () => {
    const fetchImpl = fetchReturning(200);
    let t = NOW;
    const opts = { ...options(fetchImpl), now: () => t };

    await deliverEvent(sqlite, eventId, opts);
    t = NOW + 30;
    await deliverEvent(sqlite, eventId, opts);

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][1].body).toBe(calls[1][1].body);
    const sig = (i: number) => (calls[i][1].headers as Record<string, string>)["gateway-signature"];
    expect(sig(0)).not.toBe(sig(1));
    expect(sig(1)).toContain(`t=${NOW + 30},`);
    expect(attempts().delivery_attempts).toBe(2);
  });

  it("a failed retry does not erase an earlier success", async () => {
    await deliverEvent(sqlite, eventId, options(fetchReturning(200)));
    const deliveredAt = attempts().delivered_at;
    await deliverEvent(sqlite, eventId, options(fetchReturning(500)));

    expect(attempts().delivered_at).toBe(deliveredAt);
    expect(attempts().delivery_attempts).toBe(2);
  });

  it("gives up on a receiver that hangs", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const result = await deliverEvent(sqlite, eventId, { ...options(hang), timeoutMs: 20 });

    expect(result.delivered).toBe(false);
    expect(attempts().delivery_attempts).toBe(1);
  });

  it("an unknown event sends nothing", async () => {
    const fetchImpl = fetchReturning(200);
    const result = await deliverEvent(sqlite, "evt_nope", options(fetchImpl));

    expect(result.delivered).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
