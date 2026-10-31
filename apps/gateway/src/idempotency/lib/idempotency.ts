import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export type StoredResponse = { requestHash: string; response: unknown };

/** Stable fingerprint of a request's meaningful fields, so a replay can be told apart from a different request reusing the key. */
export function hashRequest(fields: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= MAX_IDEMPOTENCY_KEY_LENGTH;
}

export function findStoredResponse(
  sqlite: Database.Database,
  key: string,
  endpoint: string,
): StoredResponse | null {
  const row = sqlite
    .prepare("SELECT request_hash, response_json FROM idempotency_keys WHERE key = ? AND endpoint = ?")
    .get(key, endpoint) as { request_hash: string; response_json: string } | undefined;

  return row ? { requestHash: row.request_hash, response: JSON.parse(row.response_json) } : null;
}

export function storeResponse(
  sqlite: Database.Database,
  key: string,
  endpoint: string,
  requestHash: string,
  response: unknown,
): void {
  sqlite
    .prepare("INSERT INTO idempotency_keys (key, endpoint, request_hash, response_json) VALUES (?, ?, ?, ?)")
    .run(key, endpoint, requestHash, JSON.stringify(response));
}
