import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken } from "./session.js";

describe("session token generation", () => {
  it("generates a different token each time (collision resistance)", () => {
    const tokenA = generateSessionToken();
    const tokenB = generateSessionToken();
    expect(tokenA).not.toBe(tokenB);
  });

  it("hashes a token deterministically — same input, same output", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("produces a hash that does not contain the raw token (what gets stored is not the raw value)", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).not.toContain(token);
    expect(hash).not.toBe(token);
  });

  it("produces different hashes for different tokens", () => {
    const hashA = hashSessionToken(generateSessionToken());
    const hashB = hashSessionToken(generateSessionToken());
    expect(hashA).not.toBe(hashB);
  });
});
