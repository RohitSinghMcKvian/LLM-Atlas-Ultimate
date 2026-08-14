"use client";

import { ARTIFACT_SANDBOX } from "./artifact-sandbox";
import { attachArtifactErrorListener, type ArtifactRuntimeError } from "./artifact-bridge";
import { VERIFY_SETTLE_MS, VERIFY_TIMEOUT_MS, type DocRun } from "./artifact-verify";

/**
 * Running an artifact where nobody is looking.
 *
 * The panel already collects runtime errors, but only while it is open, mounted,
 * and not streaming — which is to say, only when the user has already seen the
 * broken page. To find out whether an artifact works *before* that, it has to be
 * rendered somewhere else. This is that somewhere: one offscreen iframe, run
 * once, torn down.
 *
 * The only DOM in the feature. Everything that decides what the result *means*
 * lives in artifact-verify.ts, so this file stays small enough to hold in your
 * head — which matters, because a fake-DOM test can be green while a real browser
 * behaves differently, and short and boring is the only real defence.
 */

/** Injected so the harness can be driven by a fake document in tests. */
export interface VerifyEnv {
  document: Document;
  window: Window;
  now: () => number;
}

export interface RunOptions {
  /** Wait after `load` before concluding. Must exceed the blank detector's 600ms. */
  settleMs?: number;
  /** Ceiling from insertion, for a document that never fires `load`. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const HOST_ATTR = "data-atlas-verify-host";

/**
 * Where the frame lives while it runs.
 *
 * Positioned off to the left at a real viewport size, and *not* hidden. Each
 * clause was measured in a real browser rather than reasoned about, because the
 * fake-DOM tests below cannot see any of this:
 *
 *  - `display:none` is the obvious choice and is catastrophic. The frame's
 *    scripts never reached the point of reporting at all — so every artifact
 *    would hit the hard timeout and be recorded as "never finished loading",
 *    turning verification into a machine for generating false fatals.
 *  - `visibility:hidden` and any zero/tiny size leave the document laid out at
 *    **0×0**. Measured: `document.body` was 0×0 under both, against 1008×77 for
 *    the style below. Anything that measures itself — Recharts'
 *    `ResponsiveContainer`, a sized canvas, an IntersectionObserver — then sees
 *    a viewport that does not exist and either logs or throws, and the harness
 *    invents a failure the user would never have seen.
 *
 * Known limitation, also measured: `requestAnimationFrame` does **not** run in an
 * offscreen iframe under any of these styles. Animations therefore never
 * progress during a verify run. That is acceptable — the blank detector reads
 * `innerText` and separately exempts `svg,canvas,img,video,input,iframe`, so
 * neither an entrance animation nor a canvas render is mistaken for a blank
 * page. A page that paints its *only* content from inside a rAF callback, with
 * no text and no such element, would be misreported; that shape is rare enough
 * to accept rather than to hold the whole feature for.
 */
const HOST_STYLE =
  "position:fixed;left:-10000px;top:0;width:1024px;height:768px;pointer-events:none;border:0;opacity:1;z-index:-1";

function hostElement(doc: Document): HTMLElement {
  const existing = doc.querySelector(`[${HOST_ATTR}]`);
  if (existing) return existing as HTMLElement;
  const host = doc.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = HOST_STYLE;
  doc.body.appendChild(host);
  return host;
}

/**
 * One run of one document.
 *
 * Deliberately verbose about teardown: every exit path — resolved, timed out,
 * aborted, or a listener that threw — goes through the same `finish`, because a
 * frame left in the document keeps its timers and its JavaScript context alive,
 * and a page that sets an interval would then run forever behind an app the user
 * thinks is idle.
 */
export function createDocRunner(env?: Partial<VerifyEnv>) {
  return function runDoc(doc: string, options: RunOptions = {}): Promise<DocRun> {
    const d = env?.document ?? (typeof document === "undefined" ? null : document);
    const w = env?.window ?? (typeof window === "undefined" ? null : window);
    const now = env?.now ?? (() => Date.now());
    const started = now();

    const empty = (patch: Partial<DocRun>): DocRun => ({
      errors: [],
      timedOut: false,
      aborted: false,
      skipped: false,
      elapsedMs: 0,
      ...patch,
    });

    // Server-side render, or a test environment with no DOM. Skipped is not
    // clean: the caller must be able to tell "nothing broke" from "nothing ran".
    if (!d || !w || !d.body) return Promise.resolve(empty({ skipped: true }));
    if (options.signal?.aborted) return Promise.resolve(empty({ aborted: true }));

    const settleMs = options.settleMs ?? VERIFY_SETTLE_MS;
    const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS;

    return new Promise<DocRun>((resolve) => {
      const errors: ArtifactRuntimeError[] = [];
      let done = false;
      let detach: (() => void) | null = null;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;
      let frame: HTMLIFrameElement | null = null;

      const finish = (patch: Partial<DocRun>) => {
        if (done) return;
        done = true;
        if (settleTimer) clearTimeout(settleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        options.signal?.removeEventListener("abort", onAbort);
        try {
          detach?.();
        } catch {
          /* a listener that throws must not strand the frame */
        }
        if (frame) {
          // about:blank first: removing the element is enough in every browser
          // that matters, but pointing it at a blank document first makes the
          // teardown explicit rather than relying on that.
          try {
            frame.src = "about:blank";
          } catch {
            /* ignore */
          }
          frame.remove();
        }
        const host = d.querySelector(`[${HOST_ATTR}]`);
        if (host && !host.firstChild) host.remove();
        resolve(empty({ ...patch, elapsedMs: now() - started }));
      };

      function onAbort() {
        finish({ errors, aborted: true });
      }
      options.signal?.addEventListener("abort", onAbort);

      frame = d.createElement("iframe");
      // The same sandbox the panel uses. `allow-same-origin` is absent here for
      // the same reason it is absent there, and additionally because this frame
      // runs without the user having asked to see anything.
      frame.setAttribute("sandbox", ARTIFACT_SANDBOX);
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("tabindex", "-1");
      frame.style.cssText = "width:100%;height:100%;border:0";

      // Attached before the document is set, so an error thrown during the very
      // first script cannot land before anyone is listening.
      detach = attachArtifactErrorListener(frame, (e) => errors.push(e));

      frame.addEventListener("load", () => {
        if (done) return;
        // Measured from `load`, not from insertion: the blank detector inside the
        // frame starts its own 600ms at load, and React needs a commit after
        // that. Starting the clock at insertion would make a slow parse look
        // like a clean run.
        settleTimer = setTimeout(() => finish({ errors }), settleMs);
      });

      hardTimer = setTimeout(() => finish({ errors, timedOut: true }), timeoutMs);

      frame.srcdoc = doc;
      hostElement(d).appendChild(frame);
    });
  };
}

/**
 * The browser-wide runner, serialized.
 *
 * Not for correctness — `attachArtifactErrorListener` already checks
 * `event.source`, so concurrent frames could not cross-report. It is for memory:
 * a verify frame can pull React, Babel, three.js and Tailwind, and two of those
 * at once is a spike with nothing to show for it. Failures do not poison the
 * queue; the chain is rebuilt from a resolved promise either way.
 */
let queue: Promise<unknown> = Promise.resolve();

export function runArtifactDoc(doc: string, options?: RunOptions): Promise<DocRun> {
  const run = createDocRunner();
  const next = queue.then(
    () => run(doc, options),
    () => run(doc, options),
  );
  queue = next.catch(() => undefined);
  return next;
}
