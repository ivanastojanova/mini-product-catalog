import { describe, expect, it } from "vitest";

import { createKeyHolder } from "./idempotencyKey";

function counter() {
  let n = 0;
  return () => `key-${(n += 1)}`;
}

describe("createKeyHolder", () => {
  it("does not generate a key until one is asked for", () => {
    let calls = 0;
    createKeyHolder(() => `k${(calls += 1)}`);
    expect(calls).toBe(0);
  });

  it("hands out the same key on every call, so retries are recognised as the same attempt", () => {
    const holder = createKeyHolder(counter());
    expect(holder.current()).toBe("key-1");
    expect(holder.current()).toBe("key-1");
    expect(holder.current()).toBe("key-1");
  });

  it("reset starts a new attempt with a new key", () => {
    const holder = createKeyHolder(counter());
    const first = holder.current();
    holder.reset();
    const second = holder.current();
    expect(second).not.toBe(first);
    expect(holder.current()).toBe(second);
  });

  it("keeps separate holders independent", () => {
    const a = createKeyHolder(counter());
    const b = createKeyHolder(counter());
    a.current();
    a.reset();
    expect(a.current()).toBe("key-2");
    expect(b.current()).toBe("key-1");
  });

  it("generates valid-looking UUIDs with crypto.randomUUID", () => {
    const holder = createKeyHolder(() => crypto.randomUUID());
    expect(holder.current()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
