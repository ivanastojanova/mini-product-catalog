import { describe, expect, it } from "vitest";
import { validateRegisterInput } from "./validation";

const valid = { email: "shopper@example.com", password: "correct-horse", name: "Ivana" };

describe("validateRegisterInput", () => {
  it("accepts valid input", () => {
    expect(validateRegisterInput(valid)).toBeNull();
  });

  it("rejects a missing @", () => {
    const result = validateRegisterInput({ ...valid, email: "not-an-email" });
    expect(result?.field).toBe("email");
  });

  it("rejects an email with no domain", () => {
    const result = validateRegisterInput({ ...valid, email: "shopper@" });
    expect(result?.field).toBe("email");
  });

  it("rejects a password shorter than the minimum", () => {
    const result = validateRegisterInput({ ...valid, password: "short" });
    expect(result?.field).toBe("password");
  });

  it("accepts a password exactly at the minimum length", () => {
    const result = validateRegisterInput({ ...valid, password: "12345678" });
    expect(result).toBeNull();
  });

  it("rejects an empty name", () => {
    const result = validateRegisterInput({ ...valid, name: "   " });
    expect(result?.field).toBe("name");
  });
});
