"use client";

import dynamic from "next/dynamic";
import { useFlag } from "@/lib/store/flags-store";

/**
 * The mount point, kept separate from the dock itself for one reason: cost.
 *
 * This layout wraps all sixteen modules, so anything imported here is parsed on
 * every route. The dock pulls in the knowledge graph, the retrieval index, the
 * markdown renderer and framer-motion, and someone reading the leaderboard
 * should not pay for any of it. `ssr: false` plus a dynamic import means the
 * chunk is fetched when the flag is on and the panel is first mounted, following
 * the same reasoning `model-switcher-body.tsx` gives for splitting the catalog
 * out of the always-mounted topbar.
 */
const AgentDock = dynamic(() => import("./agent-dock").then((m) => m.AgentDock), { ssr: false });

export function AgentDockMount() {
  // Dark until the flag is turned on, like every other depth item in
  // `lib/flags.ts`.
  if (!useFlag("atlasDock")) return null;
  return <AgentDock />;
}
