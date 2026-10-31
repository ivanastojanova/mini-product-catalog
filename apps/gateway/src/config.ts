export type GatewayConfig = {
  port: number;
  databasePath: string;
  /** Bearer secret apps/api must present on `/v1/*`. */
  apiKey: string;
  /** Only return URLs on exactly this origin are accepted, so the gateway can't be used as an open redirect. */
  allowedReturnOrigin: string;
  /** Browser-facing base of this gateway, used to build `payUrl`. */
  publicUrl: string;
  /** Where signed events are POSTed (apps/api's `/webhooks/payments`). */
  webhookUrl: string;
  /** HMAC key shared with apps/api. */
  webhookSecret: string;
};

/** The example env files ship values starting with this; they must never run in production. */
export const PLACEHOLDER_PREFIX = "replace-me";

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid gateway configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

/**
 * Reads the environment once at boot and refuses to start on anything unsafe
 * (a missing API key would leave `/v1/*` open). Reports every problem at once.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const problems: string[] = [];

  const port = Number(env.PORT ?? 4100);
  const portIsValid = Number.isInteger(port) && port >= 1 && port <= 65535;
  if (!portIsValid) {
    problems.push("PORT must be an integer between 1 and 65535");
  }

  const apiKey = env.GATEWAY_API_KEY ?? "";
  if (apiKey === "") {
    problems.push("GATEWAY_API_KEY is required");
  }

  const webhookSecret = env.GATEWAY_WEBHOOK_SECRET ?? "";
  if (webhookSecret === "") {
    problems.push("GATEWAY_WEBHOOK_SECRET is required");
  }

  const webhookUrl = env.WEBHOOK_URL ?? "http://localhost:4000/webhooks/payments";
  if (parseOrigin(webhookUrl) === null) {
    problems.push("WEBHOOK_URL must be an http(s) URL");
  }

  const allowedReturnOrigin = parseOrigin(env.ALLOWED_RETURN_ORIGIN ?? "http://localhost:3000");
  if (allowedReturnOrigin === null) {
    problems.push("ALLOWED_RETURN_ORIGIN must be an http(s) URL");
  }

  // The default is built from PORT, so a bad PORT is reported once, not twice.
  const publicUrlSetting = env.GATEWAY_PUBLIC_URL ?? (portIsValid ? `http://localhost:${port}` : undefined);
  const publicUrl = publicUrlSetting === undefined ? undefined : parseOrigin(publicUrlSetting);
  if (publicUrl === null) {
    problems.push("GATEWAY_PUBLIC_URL must be an http(s) URL");
  }

  if (env.NODE_ENV === "production") {
    if (apiKey.startsWith(PLACEHOLDER_PREFIX)) problems.push("GATEWAY_API_KEY is still the example placeholder");
    if (webhookSecret.startsWith(PLACEHOLDER_PREFIX)) problems.push("GATEWAY_WEBHOOK_SECRET is still the example placeholder");
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    port,
    databasePath: (env.DATABASE_URL ?? "file:./gateway.db").replace(/^file:/, ""),
    apiKey,
    allowedReturnOrigin: allowedReturnOrigin as string,
    publicUrl: publicUrl as string,
    webhookUrl,
    webhookSecret,
  };
}

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
