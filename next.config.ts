import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Parsers run on the server only; keep them out of the bundler.
  serverExternalPackages: ["unpdf", "mammoth", "jszip", "msedge-tts"],
  experimental: {
    serverActions: { bodySizeLimit: "500mb" },
  },
  poweredByHeader: false,
  // The site is served with `next dev`; hide the corner badge from visitors (errors still show).
  devIndicators: false,
  // In GitHub Codespaces the site is opened through a forwarded https://…app.github.dev address,
  // which `next dev` blocks unless it is listed here. Local runs are unaffected.
  allowedDevOrigins: process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? [`*.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`]
    : [],
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
