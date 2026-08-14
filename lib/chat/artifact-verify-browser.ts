"use client";

import { errorClientScript, storageStubScript } from "./artifact-bridge";
import { needsTransform, type VerifyTarget } from "./artifact-doc";
import { verifyArtifact, type VerifyResult } from "./artifact-verify";
import { runArtifactDoc } from "./artifact-verify-frame";
import type { Transform } from "./artifact-bundle";

/**
 * The browser end of verification: pick the head, load Babel if needed, run.
 *
 * Exists so the component does not have to know any of that. It is three
 * decisions, each with a reason the call site should not have to carry:
 *
 *  - The head is the error shim plus the **stub** storage, never the real
 *    bridge. Verification renders the artifact; it must not be able to rewrite
 *    the state that artifact had saved.
 *  - Babel is imported only for a module entry, so a chat that renders HTML
 *    never downloads 3MB to check it.
 *  - `runArtifactDoc` rather than a fresh runner, so concurrent verifications
 *    queue instead of stacking three heavy frames at once.
 */
export async function verifyArtifactInBrowser(
  target: VerifyTarget,
  origin: string,
): Promise<VerifyResult | null> {
  const head = errorClientScript() + storageStubScript();
  const transform = needsTransform(target.entry, target.artifact.type, target.files.size)
    ? ((await import("@babel/standalone")).transform as unknown as Transform)
    : undefined;
  return verifyArtifact({ target, origin, head, transform }, (doc) => runArtifactDoc(doc));
}
