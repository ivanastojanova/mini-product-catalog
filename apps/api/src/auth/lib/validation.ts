/** Minimum password length — length alone, no complexity rules (NIST 800-63B treats length as the stronger signal). */
export const MIN_PASSWORD_LENGTH = 8;

/** Deliberately permissive — just "has an @ and something on both sides". Real deliverability is confirmed by use, not regex. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RegisterValidationError = {
  field: "email" | "password" | "name";
  message: string;
};

export type RegisterInput = {
  email: string;
  password: string;
  name: string;
};

/** Validates register input, returning the first failing field or null if everything's valid. */
export function validateRegisterInput(
  input: RegisterInput,
): RegisterValidationError | null {
  if (!EMAIL_PATTERN.test(input.email.trim())) {
    return { field: "email", message: "Enter a valid email address." };
  }

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return {
      field: "password",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (!input.name.trim()) {
    return { field: "name", message: "Name is required." };
  }

  return null;
}

export type LoginValidationError = {
  field: "email" | "password";
  message: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

/**
 * Validates login *shape* only (not strength) — a password set back when the
 * minimum was different, or before one existed, must still be able to log in.
 * Real credential correctness is checked against the DB, not here.
 */
export function validateLoginInput(
  input: LoginInput,
): LoginValidationError | null {
  if (!EMAIL_PATTERN.test(input.email.trim())) {
    return { field: "email", message: "Enter a valid email address." };
  }

  if (!input.password) {
    return { field: "password", message: "Password is required." };
  }

  return null;
}
