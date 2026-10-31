export type GatewayEvent = {
  id: string;
  type: string;
  data?: unknown;
};

/** Parses an already-verified body into the minimum shape every event has. Anything else is not an event. */
export function parseGatewayEvent(rawBody: string): GatewayEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { id, type } = parsed as Record<string, unknown>;
  if (typeof id !== "string" || id === "" || typeof type !== "string" || type === "") return null;

  return parsed as GatewayEvent;
}
