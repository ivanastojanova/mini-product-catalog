import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(__filename);
// npm workspaces hoist shared deps (e.g. `next`) to the monorepo root
// node_modules. Turbopack needs its root set there too, or it refuses to
// resolve/compile files living outside `apps/web`.
const monorepoRoot = path.resolve(dirname, "../..");

const cmsUrl = process.env.CMS_API_URL ?? "http://localhost:3001";
const cmsOrigin = new URL(cmsUrl);

const nextConfig: NextConfig = {
  images: {
    // Media is served by apps/cms, a separate origin from apps/web.
    remotePatterns: [
      {
        protocol: cmsOrigin.protocol.replace(":", "") as "http" | "https",
        hostname: cmsOrigin.hostname,
        port: cmsOrigin.port || undefined,
        pathname: "/api/media/file/**",
      },
    ],
    // Next's image optimizer refuses to proxy any origin that resolves to
    // a private/loopback IP (SSRF guard) — which `localhost:3001` always
    // does in local dev, since apps/cms runs on the same machine. This is
    // safe to allow here because the only private-IP origin we ever point
    // at is our own apps/cms, not arbitrary user input. In a real deploy
    // apps/cms would have a public hostname and this flag would be a no-op.
    dangerouslyAllowLocalIP: true,
  },
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
