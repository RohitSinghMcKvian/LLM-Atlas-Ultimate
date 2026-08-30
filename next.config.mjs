/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow parallel dev servers (or dev + build) without fighting over .next:
  // set NEXT_DIST_DIR to give a server its own build directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  eslint: {
    // Don't fail a production build on lint.
    //
    // This said "Lint is run separately in CI", which was not true: no workflow
    // ran lint, and `npm run lint` could not have linted anything anyway —
    // `eslint` is installed but the repo has no ESLint config, so the
    // deprecated `next lint` drops into its interactive setup prompt instead.
    // Corrected rather than deleted, because the setting itself is still the
    // one we want: type errors fail the build (see `typescript` below), style
    // findings should not.
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
        // `:path*` matters: scoped to the bare `/code`, no sub-route was
        // cross-origin isolated, so WebContainer silently failed to boot there
        // and `run_command` degraded to a MemoryWorkspace returning exit 127.
        source: "/code/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
