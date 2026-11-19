import createMDX from "@next/mdx";

const isProd = process.env.NODE_ENV === "production";
// The same rule as lib/site-urls.ts: the API is at api.<domain> unless NEXT_PUBLIC_API_URL says otherwise.
const domain = (process.env.NEXT_PUBLIC_DOMAIN_NAME || "").trim().toLowerCase();
const apiUrl = process.env.NEXT_PUBLIC_API_URL || (domain ? `https://api.${domain}` : "http://localhost:2161");

/**
 * Content Security Policy.
 *
 * `unsafe-eval` is only granted in development, where Next.js needs it for
 * HMR and source maps. Nothing in our own code uses eval, and production
 * builds do not need it, so in production it is dropped. That closes the
 * largest hole in the policy: with eval allowed, a single reflected string is
 * arbitrary code.
 *
 * `unsafe-inline` for scripts remains. Next.js emits inline bootstrap scripts,
 * and removing it requires nonce plumbing through a middleware. Worth doing,
 * but a separate piece of work.
 */
/** The origin of an address in an environment variable, or nothing when it is unset or not a URL. */
const originOf = (value) => {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
};
// Umami: the script comes from NEXT_PUBLIC_UMAMI_SCRIPT_URL and reports to NEXT_PUBLIC_UMAMI_RECORDER_URL (its own host when unset). The policy allows exactly those hosts.
const umamiScript = originOf(process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL);
const umamiRecorder = originOf(process.env.NEXT_PUBLIC_UMAMI_RECORDER_URL) || umamiScript;
// In development the admin panel can be opened at admin.localhost, where it talks to the API on that same name (lib/site-urls.ts).
const devLocalApi = isProd ? "" : " http://*.localhost:*";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}${umamiScript ? ` ${umamiScript}` : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // The API serves project images (previews, visual mode); in development
  // it is plain http on another port.
  `img-src 'self' data: blob: https: ${apiUrl}${devLocalApi}`,
  "font-src 'self' data:",
  // pdf.js runs in a worker served from public/
  "worker-src 'self' blob:",
  `connect-src 'self'${umamiRecorder ? ` ${umamiRecorder}` : ""} ws: wss: ${apiUrl}${devLocalApi}`,
  `frame-ancestors 'self' ${(process.env.NEXT_PUBLIC_ENELES_PARENT_ORIGINS || "https://aurore-section-archives.com https://aurore-section-archivescom.vercel.app https://eneles-archives-ouali1.vercel.app").split(",").map((value) => value.trim()).filter(Boolean).join(" ")}`,
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,

  // `next dev` otherwise writes AGENTS.md and CLAUDE.md into the project.
  agentRules: false,

  // The admin panel can be opened at admin.localhost in development (proxy.ts maps that host onto app/admin).
  allowedDevOrigins: ["admin.localhost"],

  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],

  serverExternalPackages: [],

  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              // The microphone is allowed for this site only: dictation records with it. Everything else stays off.
              "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
          },
          {
            key: "Content-Security-Policy",
            value: csp,
          },
        ],
      },
    ];
  },
};

const withMDX = createMDX({
  extension: /\.mdx?$/,
  // Named by string so the plugin also loads under Turbopack, which cannot take a function here. GFM gives the docs and lessons real tables.
  options: { remarkPlugins: [["remark-gfm"]] },
});

export default withMDX(config);
