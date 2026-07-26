import { getPayload, type Payload } from "payload";

import config from "@payload-config";

let cached: Payload | null = null;

/**
 * Shared Payload Local API instance for server-side reads.
 * Prefer this over REST so RSC pages can pass `locale` and depth directly.
 */
export async function getPayloadClient(): Promise<Payload> {
  if (cached) {
    return cached;
  }

  cached = await getPayload({ config });
  return cached;
}
