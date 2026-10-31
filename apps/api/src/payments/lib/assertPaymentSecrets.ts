/** Same prefix the example env files use for their placeholders. */
const PLACEHOLDER_PREFIX = "replace-me";

/**
 * Called once at boot. In production the payment secrets must be set and must
 * not be the example placeholders: a known webhook secret would let anyone
 * forge "payment succeeded" events. Outside production a missing secret is
 * tolerated here (the webhook route itself fails closed with a 500).
 */
export function assertPaymentSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const problems: string[] = [];
  for (const name of ["GATEWAY_WEBHOOK_SECRET", "GATEWAY_API_KEY"] as const) {
    const value = env[name] ?? "";
    if (value === "") problems.push(`${name} is required in production`);
    else if (value.startsWith(PLACEHOLDER_PREFIX)) problems.push(`${name} is still the example placeholder`);
  }

  if (problems.length > 0) {
    throw new Error(`Invalid payment configuration:\n- ${problems.join("\n- ")}`);
  }
}
