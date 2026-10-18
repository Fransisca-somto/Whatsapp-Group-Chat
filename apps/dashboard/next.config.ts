import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source with no build step (ADR-017).
  transpilePackages: ["@soft-agent-support/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
