// Copies the pinned artifact runtime out of node_modules and into
// public/artifact-runtime/ so sandboxed artifacts can load React and the JSX
// transpiler from Atlas's own origin instead of a third-party CDN.
//
// Why this exists (spec §1.4 / §4):
//   - Zero telemetry: a CDN <script> tells unpkg.com who is viewing an artifact.
//   - The artifact iframe runs at an opaque origin under a strict CSP that only
//     whitelists Atlas's origin, so a remote script tag would be blocked anyway.
//   - COEP `require-corp` (needed by WebContainers) rejects cross-origin scripts
//     that don't opt in, which the unpkg builds don't.
//
// Generated output is gitignored; this runs from `postinstall` and `prebuild`
// so a clean checkout and a CI build both produce it.

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "artifact-runtime");

/**
 * source in node_modules → filename served under /artifact-runtime/
 *
 * This is the pinned runtime set from spec §4. Artifacts load only the files
 * they actually reference (see RUNTIME_LIBS in lib/chat/artifact-sandbox.ts),
 * so the total size here is not a per-render cost.
 *
 * `three`, `mathjs` and `@tailwindcss/browser` are devDependencies: the app never
 * imports them, this script just copies them.
 *
 * Tailwind used to be excluded here because the only distribution was a
 * third-party CDN. `@tailwindcss/browser` is an npm package, so it is vendored
 * like everything else and §1.4 still holds — the bundle contains no `fetch` and
 * no `XMLHttpRequest`, it compiles inside the artifact frame. Note it is
 * Tailwind v4 while the app itself builds on 3.4; artifacts are isolated
 * documents, so the two never meet.
 */
const ASSETS = [
  ["react/umd/react.production.min.js", "react.js"],
  ["react-dom/umd/react-dom.production.min.js", "react-dom.js"],
  ["@babel/standalone/babel.min.js", "babel.js"],
  ["recharts/umd/Recharts.js", "recharts.js"],
  ["d3/dist/d3.min.js", "d3.js"],
  ["three/build/three.min.js", "three.js"],
  ["mathjs/lib/browser/math.js", "mathjs.js"],
  ["papaparse/papaparse.min.js", "papaparse.js"],
  ["lucide-react/dist/umd/lucide-react.min.js", "lucide-react.js"],
  ["@tailwindcss/browser/dist/index.global.js", "tailwind.js"],
  // A real UMD build (`.Motion = {}`, taking React off the same global object),
  // so it needs no wrapper — it just was never copied. Models reach for
  // framer-motion for any animated landing page whatever the prompt says, and
  // every one of them failed to bundle with `cannot resolve import
  // "framer-motion"` while the build sat unused in node_modules.
  ["framer-motion/dist/framer-motion.js", "framer-motion.js"],
];

/**
 * Files we author rather than vendor, copied from scripts/.
 *
 * `next/link`, `clsx` and `tailwind-merge` have no UMD build to copy — see the
 * header of scripts/artifact-shims.js. It lives there rather than directly in
 * public/artifact-runtime/ because that whole directory is gitignored as
 * generated output, so an authored file in it would not survive a clean checkout.
 */
const AUTHORED = [["artifact-shims.js", "atlas-shims.js"]];

await mkdir(outDir, { recursive: true });

const here = dirname(fileURLToPath(import.meta.url));
let copied = 0;
const total = ASSETS.length + AUTHORED.length;

for (const [from, to] of ASSETS) {
  const src = join(root, "node_modules", from);
  if (!existsSync(src)) {
    // Don't fail the build: the artifact panel degrades to the Code tab when a
    // runtime file is missing, and failing here would block `npm ci` entirely.
    console.warn(`[vendor-artifact-runtime] missing ${from} — skipped`);
    continue;
  }
  await copyFile(src, join(outDir, to));
  copied++;
}

for (const [from, to] of AUTHORED) {
  const src = join(here, from);
  if (!existsSync(src)) {
    console.warn(`[vendor-artifact-runtime] missing scripts/${from} — skipped`);
    continue;
  }
  await copyFile(src, join(outDir, to));
  copied++;
}

console.log(`[vendor-artifact-runtime] wrote ${copied}/${total} → public/artifact-runtime/`);
