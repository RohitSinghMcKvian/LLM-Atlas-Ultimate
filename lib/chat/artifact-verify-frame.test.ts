import { describe, it, expect } from "vitest";
import { createDocRunner } from "./artifact-verify-frame";
import { ERROR_PROTOCOL } from "./artifact-bridge";
import { ARTIFACT_SANDBOX } from "./artifact-sandbox";

/**
 * The offscreen frame harness.
 *
 * Driven by a fake DOM, in the style of artifact-bridge.test.ts. What that can
 * and cannot prove is worth being explicit about: it pins the **lifecycle** —
 * attach before insert, tear down on every exit path, serialize, never leak a
 * frame — and it cannot prove anything about how a real browser lays out a
 * hidden iframe. That half is a manual browser pass, which is why the harness is
 * kept short and boring enough to read.
 */

interface FakeEl {
  tagName: string;
  attrs: Record<string, string>;
  style: { cssText: string };
  children: FakeEl[];
  parent: FakeEl | null;
  firstChild: FakeEl | null;
  srcdoc?: string;
  src?: string;
  listeners: Record<string, (() => void)[]>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(c: FakeEl): FakeEl;
  remove(): void;
  addEventListener(t: string, fn: () => void): void;
}

function el(tagName: string): FakeEl {
  const node: FakeEl = {
    tagName,
    attrs: {},
    style: { cssText: "" },
    children: [],
    parent: null,
    firstChild: null,
    listeners: {},
    setAttribute(k, v) {
      node.attrs[k] = v;
    },
    getAttribute(k) {
      return k in node.attrs ? node.attrs[k] : null;
    },
    appendChild(c) {
      node.children.push(c);
      c.parent = node;
      node.firstChild = node.children[0] ?? null;
      return c;
    },
    remove() {
      if (!node.parent) return;
      const i = node.parent.children.indexOf(node);
      if (i >= 0) node.parent.children.splice(i, 1);
      node.parent.firstChild = node.parent.children[0] ?? null;
      node.parent = null;
    },
    addEventListener(t, fn) {
      (node.listeners[t] ??= []).push(fn);
    },
  };
  return node;
}

function harness() {
  const log: string[] = [];
  const body = el("body");
  const messageListeners: ((e: MessageEvent) => void)[] = [];

  const doc = {
    body,
    createElement: (t: string) => {
      const node = el(t);
      if (t === "iframe") {
        // Record the moment the document is assigned and the moment it is
        // inserted, so the ordering assertion below is about real calls.
        Object.defineProperty(node, "srcdoc", {
          set(v: string) {
            log.push("srcdoc");
            (node as { _srcdoc?: string })._srcdoc = v;
          },
          get() {
            return (node as { _srcdoc?: string })._srcdoc;
          },
        });
      }
      return node;
    },
    querySelector: (sel: string) => {
      const attr = sel.replace(/^\[|\]$/g, "");
      return body.children.find((c) => attr in c.attrs) ?? null;
    },
  } as unknown as Document;

  // Insertion is what starts loading, so it is logged from appendChild.
  const originalAppend = body.appendChild.bind(body);
  body.appendChild = (c: FakeEl) => {
    const r = originalAppend(c);
    const inner = c.appendChild.bind(c);
    c.appendChild = (g: FakeEl) => {
      if (g.tagName === "iframe") log.push("insert");
      return inner(g);
    };
    return r;
  };

  const win = {
    addEventListener: (t: string, fn: (e: MessageEvent) => void) => {
      if (t === "message") messageListeners.push(fn);
    },
    removeEventListener: (t: string, fn: (e: MessageEvent) => void) => {
      const i = messageListeners.indexOf(fn);
      if (i >= 0) messageListeners.splice(i, 1);
    },
  } as unknown as Window;

  // The harness attaches the real `attachArtifactErrorListener`, which binds to
  // `globalThis.window`.
  globalThis.window = win as Window & typeof globalThis;

  const frameOf = () => {
    const host = body.children.find((c) => "data-atlas-verify-host" in c.attrs);
    return host?.children[0];
  };

  return {
    doc,
    body,
    log,
    frameOf,
    hostCount: () => body.children.filter((c) => "data-atlas-verify-host" in c.attrs).length,
    listenerCount: () => messageListeners.length,
    /** Fire the frame's `load`, which starts the settle timer. */
    load: () => frameOf()?.listeners.load?.forEach((fn) => fn()),
    /**
     * Deliver an error report as if from the frame.
     *
     * Tolerates a frame that has already been torn down, because that is exactly
     * the case one test needs: after teardown the listener is gone, so the
     * dispatch must be a no-op rather than an error.
     */
    report: (message: string, kind = "error") => {
      const frame = frameOf() as unknown as { contentWindow?: unknown } | undefined;
      if (frame) frame.contentWindow ??= {};
      const source = frame?.contentWindow ?? {};
      for (const fn of [...messageListeners]) {
        fn({ data: { protocol: ERROR_PROTOCOL, kind, message }, source } as MessageEvent);
      }
    },
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("the verify frame", () => {
  it("uses the panel's sandbox and never allow-same-origin", () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    void runner("<html></html>");
    expect(h.frameOf()?.getAttribute("sandbox")).toBe(ARTIFACT_SANDBOX);
    // Asserted separately: this is the line that keeps a model-written page out
    // of the user's localStorage, where their API key lives.
    expect(h.frameOf()?.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("attaches the error listener before inserting the frame", async () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    void runner("<html></html>");
    // Loading starts at insertion, so a listener attached afterwards would miss
    // anything thrown by the first script.
    expect(h.log.indexOf("srcdoc")).toBeLessThan(h.log.indexOf("insert"));
    expect(h.listenerCount()).toBe(1);
  });

  it("is not hidden with display:none or a zero size", () => {
    // Measured in a real browser: display:none stops the frame reporting at all
    // (every artifact would hit the hard timeout), and visibility:hidden or a
    // zero size lays the document out at 0x0, which makes self-measuring
    // components log or throw. Offscreen at a real viewport avoids both.
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    void runner("<html></html>");
    const host = h.body.children.find((c) => "data-atlas-verify-host" in c.attrs)!;
    expect(host.style.cssText).not.toContain("display:none");
    expect(host.style.cssText).not.toContain("visibility:hidden");
    expect(host.style.cssText).toContain("width:1024px");
  });

  it("resolves after the settle window, carrying what arrived", async () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    const p = runner("<html></html>", { settleMs: 30, timeoutMs: 500 });
    h.load();
    h.report("TypeError: boom");
    const r = await p;
    expect(r.errors.map((e) => e.message)).toEqual(["TypeError: boom"]);
    expect(r.timedOut).toBe(false);
  });

  it("times out rather than reporting a hung page as clean", async () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    // `load` never fires.
    const r = await runner("<html></html>", { settleMs: 30, timeoutMs: 40 });
    expect(r.timedOut).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("removes the frame and the host on a normal exit", async () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    const p = runner("<html></html>", { settleMs: 20, timeoutMs: 500 });
    h.load();
    await p;
    expect(h.frameOf()).toBeUndefined();
    expect(h.hostCount()).toBe(0);
    expect(h.listenerCount()).toBe(0);
  });

  it("removes the frame on timeout too", async () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    await runner("<html></html>", { settleMs: 30, timeoutMs: 40 });
    expect(h.hostCount()).toBe(0);
    expect(h.listenerCount()).toBe(0);
  });

  it("ignores an error that arrives after it resolved", async () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    const p = runner("<html></html>", { settleMs: 20, timeoutMs: 500 });
    h.load();
    const r = await p;
    expect(() => h.report("late error")).not.toThrow();
    expect(r.errors).toEqual([]);
  });

  it("aborts without creating a frame when the signal is already aborted", async () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    const ac = new AbortController();
    ac.abort();
    const r = await runner("<html></html>", { signal: ac.signal });
    expect(r.aborted).toBe(true);
    expect(h.hostCount()).toBe(0);
  });

  it("aborts mid-run and tears down", async () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    const ac = new AbortController();
    const p = runner("<html></html>", { settleMs: 5000, timeoutMs: 9000, signal: ac.signal });
    h.load();
    ac.abort();
    const r = await p;
    expect(r.aborted).toBe(true);
    expect(h.hostCount()).toBe(0);
    expect(h.listenerCount()).toBe(0);
  });

  it("skips when there is no DOM, and skipped is not clean", async () => {
    const runner = createDocRunner({
      document: undefined as unknown as Document,
      window: undefined as unknown as Window,
    });
    const r = await runner("<html></html>");
    expect(r.skipped).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("reports elapsed time from an injected clock", async () => {
    const h = harness();
    let t = 1000;
    const runner = createDocRunner({
      document: h.doc,
      window: globalThis.window,
      now: () => (t += 50),
    });
    const p = runner("<html></html>", { settleMs: 10, timeoutMs: 500 });
    h.load();
    const r = await p;
    expect(r.elapsedMs).toBeGreaterThan(0);
  });

  it("uses one host element across sequential runs", async () => {
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    for (let i = 0; i < 2; i++) {
      const p = runner("<html></html>", { settleMs: 10, timeoutMs: 300 });
      await tick(1);
      h.load();
      await p;
    }
    expect(h.hostCount()).toBe(0);
    expect(h.listenerCount()).toBe(0);
  });

  it("gives each run a fresh frame", async () => {
    // Reassigning srcdoc can reuse the browsing context, so a previous run's
    // timer would report into the next run's listener.
    const h = harness();
    const runner = createDocRunner({ document: h.doc, window: globalThis.window });
    const p1 = runner("<html>a</html>", { settleMs: 10, timeoutMs: 300 });
    const first = h.frameOf();
    h.load();
    await p1;
    const p2 = runner("<html>b</html>", { settleMs: 10, timeoutMs: 300 });
    const second = h.frameOf();
    expect(second).not.toBe(first);
    h.load();
    await p2;
  });
});
