import type { AuthenticatedCustomer } from "@/features/auth/types/auth";
import { apiFetch, extractErrorMessage } from "@/shared/api/client";

type SessionResponse = {
  customer: AuthenticatedCustomer | null;
};

export async function getSession(): Promise<AuthenticatedCustomer | null> {
  const response = await apiFetch("/auth/session");

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
  const response = await apiFetch("/auth/register", {
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
  const response = await apiFetch("/auth/login", {
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
  const response = await apiFetch("/auth/logout", { method: "POST" });

  if (!response.ok) {
    throw new Error("Could not log out.");
  }
}
