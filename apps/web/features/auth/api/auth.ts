import type { AuthenticatedCustomer } from "@/features/auth/types/auth";

type SessionResponse = {
  customer: AuthenticatedCustomer | null;
};

/**
 * apps/api's origin — a genuinely separate service from apps/web (see
 * docs/adr/0004-standalone-commerce-api-service.md), reached from the
 * browser, so this must be a `NEXT_PUBLIC_` var, not a server-only one.
 */
function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured");
  }
  return url.replace(/\/+$/, "");
}

/**
 * Every auth call is cross-origin (apps/web's port vs. apps/api's port), so
 * `credentials: "include"` is required on every request — without it the
 * browser won't send or store the session cookie, regardless of apps/api's
 * CORS headers being correct.
 */
function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
  });
}

/** Extracts a server error message, falling back to a generic one if the body isn't JSON or has no `message`. */
async function extractErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string };
    return data.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getSession(): Promise<AuthenticatedCustomer | null> {
  const response = await authFetch("/auth/session");

  if (!response.ok) {
    throw new Error("Failed to load session");
  }

  const data = (await response.json()) as SessionResponse;
  return data.customer;
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
}): Promise<AuthenticatedCustomer> {
  const response = await authFetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Could not register."));
  }

  return response.json() as Promise<AuthenticatedCustomer>;
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthenticatedCustomer> {
  const response = await authFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Could not log in."));
  }

  return response.json() as Promise<AuthenticatedCustomer>;
}

export async function logout(): Promise<void> {
  const response = await authFetch("/auth/logout", { method: "POST" });

  if (!response.ok) {
    throw new Error("Could not log out.");
  }
}
