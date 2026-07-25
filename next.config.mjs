/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow parallel dev servers (or dev + build) without fighting over .next:
  // set NEXT_DIST_DIR to give a server its own build directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  eslint: {
    // Lint is run separately in CI; don't fail production builds on lint.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Keep type-safety strict at build time.
    ignoreBuildErrors: false,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "framer-motion"],
    // Next 15 defaults dynamic entries to 0s, which expires a sidebar
    // prefetch before the user can click it — the payload is fetched and
    // then thrown away. Workspace routes render from the static catalog and
    // client state, so there is nothing that goes stale in 30s.
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    return [
      {
        // Atlas Code only: cross-origin isolation so WebContainer can use
        // SharedArrayBuffer. Scoped to /code because COEP require-corp blocks
        // cross-origin subresources that lack CORP/CORS headers, which would
        // break external images elsewhere. Monaco + Pyodide load from
        // jsDelivr, which serves Cross-Origin-Resource-Policy: cross-origin.
        source: "/code",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
