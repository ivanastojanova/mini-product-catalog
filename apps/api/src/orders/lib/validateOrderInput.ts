import { EMAIL_PATTERN } from "../../auth/lib/validation.js";

export type ShippingAddress = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  country: string;
};

export type OrderInputError = { field: string; message: string };

export type ValidatedOrderInput = {
  shippingAddress: ShippingAddress;
  /** Required for guests, null for customers (their account email is used instead). */
  email: string | null;
};

const MAX = { name: 100, line: 200, city: 100, postalCode: 20, email: 254 };

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

/**
 * Validates the `POST /orders` body. Shape and bounds only: required, trimmed,
 * length-capped, 2-letter country. Real address validity is out of scope. Never
 * reads prices or totals from the body: those come from the CMS.
 */
export function validateOrderInput(
  body: unknown,
  isGuest: boolean,
): { ok: true; value: ValidatedOrderInput } | { ok: false; error: OrderInputError } {
  const fail = (field: string, message: string) => ({ ok: false as const, error: { field, message } });

  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const address = (
    typeof input.shippingAddress === "object" && input.shippingAddress !== null
      ? input.shippingAddress
      : {}
  ) as Record<string, unknown>;

  const required = (field: string, value: unknown, label: string, max: number) => {
    const trimmed = text(value);
    if (!trimmed) return { error: fail(`shippingAddress.${field}`, `${label} is required.`) };
    if (trimmed.length > max) return { error: fail(`shippingAddress.${field}`, `${label} is too long.`) };
    return { value: trimmed };
  };

  const name = required("name", address.name, "Name", MAX.name);
  if (name.error) return name.error;
  const line1 = required("line1", address.line1, "Address", MAX.line);
  if (line1.error) return line1.error;
  const city = required("city", address.city, "City", MAX.city);
  if (city.error) return city.error;
  const postalCode = required("postalCode", address.postalCode, "Postal code", MAX.postalCode);
  if (postalCode.error) return postalCode.error;

  let line2: string | null = null;
  if (address.line2 !== undefined && address.line2 !== null) {
    const trimmed = text(address.line2);
    if (trimmed === null) return fail("shippingAddress.line2", "Address line 2 must be text.");
    if (trimmed.length > MAX.line) return fail("shippingAddress.line2", "Address line 2 is too long.");
    line2 = trimmed === "" ? null : trimmed;
  }

  const country = text(address.country)?.toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(country)) {
    return fail("shippingAddress.country", "Country must be a 2-letter code.");
  }

  let email: string | null = null;
  if (isGuest) {
    const trimmed = text(input.email) ?? "";
    if (!EMAIL_PATTERN.test(trimmed) || trimmed.length > MAX.email) {
      return fail("email", "Enter a valid email address.");
    }
    email = trimmed;
  }

  return {
    ok: true,
    value: {
      shippingAddress: {
        name: name.value!,
        line1: line1.value!,
        line2,
        city: city.value!,
        postalCode: postalCode.value!,
        country,
      },
      email,
    },
  };
}
