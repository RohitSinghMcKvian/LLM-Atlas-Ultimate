import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as Babel from "@babel/standalone";
import { runArtifactRepair } from "./artifact-repair-run";
import { repairLimitsFor } from "./artifact-repair";
import { verifyArtifact, type DocRun } from "./artifact-verify";
import { buildArtifactDoc, singleFileMap, verifyEntryOf } from "./artifact-doc";
import { extractArtifacts } from "./artifact-extract";
import {
  listArtifactsForConversation,
  listVersions,
  recordVersion,
  resetArtifactDb,
} from "./artifact-repo";
import { errorClientScript, storageStubScript } from "./artifact-bridge";
import type { Transform } from "./artifact-bundle";

/**
 * The whole self-heal chain, composed.
 *
 * Real everything except two things: the model stream, and the browser frame.
 * Real `extractArtifacts`, real `bundleModules` with real Babel, real
 * `recordVersion`/`listVersions` on fake-indexeddb, real triage, real state
 * machine, real driver. The unit tests each pin one piece; this is the one that
 * catches a chain that is individually correct and jointly wrong — a version
 * recorded under the wrong path, a repair that overwrites the original instead
 * of appending, a fix that is never actually re-run.
 *
 * The `DocRunner` is scripted on the document's *content*, not on a call count,
 * so "the fix worked" means the fix is genuinely in the document that was built.
 */
const transform = Babel.transform as unknown as Transform;
const ORIGIN = "https://atlas.test";
const CONV = "conv-selfheal";
const ENTRY = "src/App.jsx";

const BROKEN = `
import { Rocket } from "lucide-react";
export default function App() {
  return <div><Rocket /><h1>{missingVar}</h1></div>;
}
`;
const FIXED = `
import { Rocket } from "lucide-react";
export default function App() {
  const label = "NASA";
  return <div><Rocket /><h1>{label}</h1></div>;
}
`;

const run = (patch: Partial<DocRun> = {}): DocRun => ({
  errors: [],
  timedOut: false,
  aborted: false,
  skipped: false,
  elapsedMs: 5,
  ...patch,
});

/** Read the conversation's artifacts back the way the app does. */
async function snapshot() {
  const stored = await listArtifactsForConversation(CONV);
  return Promise.all(
    stored.map(async (a) => ({
      path: a.path ?? "index.html",
      versions: (await listVersions(a.id)).map((v) => ({ code: v.code, type: v.kind })),
    })),
  );
}

/** The verify port, wired exactly as the browser one is. */
function verifyPort(runner: (doc: string) => Promise<DocRun>) {
  return async () => {
    const target = verifyEntryOf(await snapshot());
    if (!target) return null;
    return verifyArtifact(
      { target, origin: ORIGIN, head: errorClientScript() + storageStubScript(), transform },
      runner,
    );
  };
}

/**
 * A frame that throws only while the offending token is still in the document.
 *
 * The token must be one that cannot appear anywhere else in the built document.
 * The injected error shim ships its own source comments, and an earlier version
 * of this used the word "broken" — which the shim's comment about a broken
 * `<img>` matched, so a successful repair still looked like a failure.
 */
const runnerFor = (brokenToken: string) => async (doc: string) =>
  doc.includes(brokenToken)
    ? run({
        errors: [
          { kind: "error", message: `Uncaught ReferenceError: ${brokenToken} is not defined`, line: 4 },
        ],
      })
    : run();

/** Apply a model reply the way `runRepairTurn` does. */
async function applyReply(text: string): Promise<boolean> {
  const match = extractArtifacts(text).find((a) => a.complete !== false && a.code.trim());
  if (!match) return false;
  await recordVersion({
    conversationId: CONV,
    // No messageId: with one, `recordVersion` updates the same-turn row in
    // place and the broken original is lost with it.
    messageId: undefined,
    // The known path, never the reply's — a reply that dropped `path=` would
    // otherwise be filed as a competing artifact.
    path: ENTRY,
    kind: match.type,
    lang: match.lang,
    title: match.title,
    code: match.code,
  });
  return true;
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetArtifactDb();
  await recordVersion({
    conversationId: CONV,
    messageId: "msg-1",
    path: ENTRY,
    kind: "react",
    lang: "jsx",
    title: "App",
    code: BROKEN,
  });
});

describe("verify and repair, end to end", () => {
  it("fixes the artifact and keeps both versions", async () => {
    const repairTurn = vi.fn(async () => {
      await applyReply(`Fixed it.\n\n\`\`\`jsx path="${ENTRY}"\n${FIXED}\n\`\`\``);
      return { artifactChanged: true, spentUsd: 0.02 };
    });

    const { state } = await runArtifactRepair(ENTRY, repairLimitsFor(false), {
      verify: verifyPort(runnerFor("missingVar")),
      repairTurn,
    });

    expect(state.status).toBe("clean");
    expect(repairTurn).toHaveBeenCalledTimes(1);

    // Two versions: broken, then fixed. One overwriting the other is what makes
    // Diff and Revert stop working.
    const [artifact] = await listArtifactsForConversation(CONV);
    const versions = await listVersions(artifact.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].code).toContain("missingVar");
    expect(versions[1].code).toContain('const label = "NASA"');
  });

  it("keeps the fix under the same path rather than creating a rival artifact", async () => {
    // The reply drops the `path=` attribute, which is common.
    const repairTurn = vi.fn(async () => {
      await applyReply(`\`\`\`jsx\n${FIXED}\n\`\`\``);
      return { artifactChanged: true, spentUsd: 0.02 };
    });
    await runArtifactRepair(ENTRY, repairLimitsFor(false), {
      verify: verifyPort(runnerFor("missingVar")),
      repairTurn,
    });
    const all = await listArtifactsForConversation(CONV);
    expect(all).toHaveLength(1);
    expect(all[0].path).toBe(ENTRY);
  });

  it("spends nothing when the artifact already runs", async () => {
    globalThis.indexedDB = new IDBFactory();
  resetArtifactDb();
    await recordVersion({
      conversationId: CONV,
      messageId: "m",
      path: ENTRY,
      kind: "react",
      lang: "jsx",
      title: "App",
      code: FIXED,
    });
    const repairTurn = vi.fn(async () => ({ artifactChanged: true, spentUsd: 1 }));
    const { state } = await runArtifactRepair(ENTRY, repairLimitsFor(false), {
      verify: verifyPort(runnerFor("missingVar")),
      repairTurn,
    });
    expect(repairTurn).not.toHaveBeenCalled();
    expect(state.status).toBe("clean");
  });

  it("spends nothing on a cosmetic warning", async () => {
    const repairTurn = vi.fn(async () => ({ artifactChanged: true, spentUsd: 1 }));
    const { state, verified } = await runArtifactRepair(ENTRY, repairLimitsFor(false), {
      verify: verifyPort(async () =>
        run({
          errors: [
            {
              kind: "console",
              message: 'Each child in a list should have a unique "key" prop.',
            },
          ],
        }),
      ),
      repairTurn,
    });
    expect(repairTurn).not.toHaveBeenCalled();
    expect(state.status).toBe("clean");
    // Still reported, just never repaired.
    expect(verified?.warnings).toHaveLength(1);
  });

  it("spends nothing when Atlas is the one at fault", async () => {
    globalThis.indexedDB = new IDBFactory();
  resetArtifactDb();
    const code = `import gsap from "gsap"; export default () => null;`;
    await recordVersion({
      conversationId: CONV,
      messageId: "m",
      path: ENTRY,
      kind: "react",
      lang: "jsx",
      title: "App",
      code,
    });
    // `gsap` is not on the list, so this one IS the model's mistake and is
    // fatal — the bundler never even builds a document.
    const frame = vi.fn(async () => run());
    const repairTurn = vi.fn(async () => ({ artifactChanged: false, spentUsd: 1 }));
    const { verified } = await runArtifactRepair(ENTRY, repairLimitsFor(false, { maxAttempts: 0 }), {
      verify: verifyPort(frame),
      repairTurn,
    });
    expect(frame).not.toHaveBeenCalled();
    expect(verified?.ran).toBe(false);
    expect(verified?.fatal[0].message).toContain("gsap");
  });

  it("stops after one attempt when the model changed nothing", async () => {
    const repairTurn = vi.fn(async () => ({ artifactChanged: false, spentUsd: 0.02 }));
    const { state } = await runArtifactRepair(ENTRY, repairLimitsFor(true), {
      verify: verifyPort(runnerFor("missingVar")),
      repairTurn,
    });
    expect(repairTurn).toHaveBeenCalledTimes(1);
    expect(state.gaveUpBecause).toBe("no-progress");
    const [a] = await listArtifactsForConversation(CONV);
    expect(await listVersions(a.id)).toHaveLength(1);
  });

  it("stops when the same failure survives the repair", async () => {
    // The model rewrites the file but leaves the bug in.
    const repairTurn = vi.fn(async () => {
      await applyReply(`\`\`\`jsx\n${BROKEN}\n// tweaked\n\`\`\``);
      return { artifactChanged: true, spentUsd: 0.02 };
    });
    const { state } = await runArtifactRepair(ENTRY, repairLimitsFor(true), {
      verify: verifyPort(runnerFor("missingVar")),
      repairTurn,
    });
    expect(repairTurn).toHaveBeenCalledTimes(1);
    expect(state.gaveUpBecause).toBe("repeat");
    expect(state.surviving[0]).toContain("missingVar");
  });

  it("repairs a multi-file build through its entry", async () => {
    globalThis.indexedDB = new IDBFactory();
  resetArtifactDb();
    await recordVersion({
      conversationId: CONV, messageId: "m1", path: "src/App.jsx", kind: "react", lang: "jsx",
      title: "App", code: `import Nav from "./Nav";\nexport default () => <Nav/>;`,
    });
    await recordVersion({
      conversationId: CONV, messageId: "m2", path: "src/Nav.jsx", kind: "react", lang: "jsx",
      title: "Nav", code: `export default () => <nav>{navSentinel}</nav>;`,
    });

    const repairTurn = vi.fn(async () => {
      await recordVersion({
        conversationId: CONV, messageId: undefined, path: "src/Nav.jsx", kind: "react",
        lang: "jsx", title: "Nav", code: `export default () => <nav>ok</nav>;`,
      });
      return { artifactChanged: true, spentUsd: 0.02 };
    });

    const { state } = await runArtifactRepair("src/App.jsx", repairLimitsFor(true), {
      verify: verifyPort(runnerFor("navSentinel")),
      repairTurn,
    });
    expect(state.status).toBe("clean");
  });
});

describe("the document the repair loop actually judges", () => {
  it("is the one the panel would render", async () => {
    // If these ever diverge, every verdict above is about a document the user
    // will never see.
    const files = singleFileMap(ENTRY, FIXED);
    const artifact = { type: "react" as const, code: FIXED };
    const panel = buildArtifactDoc({ files, entry: ENTRY, artifact, origin: ORIGIN, head: "<!--P-->", transform });
    const verifyHead = errorClientScript() + storageStubScript();
    const verifier = buildArtifactDoc({ files, entry: ENTRY, artifact, origin: ORIGIN, head: verifyHead, transform });
    expect(panel.errors).toEqual([]);
    expect(verifier.doc.replace(verifyHead, "")).toBe(panel.doc.replace("<!--P-->", ""));
  });

  it("never carries the real storage bridge into a verification run", async () => {
    // Verification renders the artifact. It must not be able to rewrite the
    // state that artifact had saved.
    const doc = buildArtifactDoc({
      files: singleFileMap(ENTRY, FIXED),
      entry: ENTRY,
      artifact: { type: "react", code: FIXED },
      origin: ORIGIN,
      head: errorClientScript() + storageStubScript(),
      transform,
    }).doc;
    expect(doc).toContain("window.storage=");
    expect(doc).not.toContain("atlas-artifact-storage");
  });
});
