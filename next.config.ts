import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Parsers run on the server only; keep them out of the bundler.
  serverExternalPackages: ["unpdf", "mammoth", "jszip", "msedge-tts"],
  // Hosted (Vercel) functions only get the files they import: ship the saved Proof Lab results
  // and question sets with the routes that read them.
  outputFileTracingIncludes: {
    "/api/bench": ["./data/bench/**/*", "./eval/bench/**/*"],
    "/api/bench/**": ["./data/bench/**/*", "./eval/bench/**/*"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "500mb" },
  },
  poweredByHeader: false,
  // The site is served with `next dev`; hide the corner badge from visitors (errors still show).
  devIndicators: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
      ],
    }];
  },
};

export default nextConfig;
