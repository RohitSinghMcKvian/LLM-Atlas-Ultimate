"use client";

import { PRINT_CSP, printDocumentHtml, type PrintMode } from "./document";

/**
 * The browser half of PDF export.
 *
 * There is no PDF library here, and that is the design rather than a shortcut.
 * Every browser already ships a layout engine and a PDF writer behind
 * `window.print()` → "Save as PDF"; adding jsPDF or headless Chrome would mean
 * shipping a second, worse renderer that agrees with the first only by accident,
 * and §1.4 rules out a service that would do it remotely. So Atlas builds the
 * document and asks the browser to print it.
 *
 * Two paths, because artifacts live in two different documents:
 *
 *  - **Prose** (`document`, `slides`, `markdown`) is rendered by the parent, so
 *    the parent lifts the rendered markup into a hidden print frame that carries
 *    paper CSS. Same origin, so `contentWindow.print()` is reachable.
 *  - **Executable** (`html`, `react`, `svg`) lives in an opaque-origin sandbox
 *    the parent cannot reach into at all. It prints *itself*, on request, over
 *    the same postMessage channel the storage bridge uses.
 */

export const PRINT_PROTOCOL = "atlas-artifact-print";

/** How long a print frame stays attached before it is cleaned up. */
const FRAME_TTL_MS = 60_000;

/**
 * Print an already-built HTML document.
 *
 * The frame is deliberately *not* sandboxed: `sandbox` without
 * `allow-same-origin` would make `contentWindow.print()` unreachable, which is
 * the one thing this function exists to call. It is safe because the document is
 * one Atlas assembled — the body is markup from the app's own Markdown renderer,
 * which escapes raw HTML rather than passing it through — and because
 * `PRINT_CSP` refuses scripts and every remote load anyway.
 */
export function printHtmlDocument(html: string): void {
  if (typeof document === "undefined") return;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.title = "Print preview";
  // Off-screen rather than display:none — a frame that was never laid out has
  // no pages to print in some engines.
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;opacity:0;pointer-events:none";

  let done = false;
  const remove = () => {
    if (done) return;
    done = true;
    frame.remove();
  };

  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return remove();
    // Inserting an iframe fires `load` once for the implicit about:blank
    // document, before the srcdoc content has been parsed. Printing on that
    // event produces a blank sheet — found by driving this live, not in a unit
    // test, because the empty document is perfectly well-formed. A srcdoc
    // document reports its URL as "about:srcdoc", so the blank pass is skipped.
    if (isBlank(win)) return;

    // The frame is removed on afterprint rather than immediately: Safari and
    // Firefox return from print() before the dialog closes, and tearing the
    // document down under an open dialog prints a blank page.
    try {
      win.addEventListener("afterprint", remove, { once: true });
    } catch {
      /* ignore — the timeout below is the backstop */
    }
    setTimeout(remove, FRAME_TTL_MS);
    try {
      win.focus();
      win.print();
    } catch {
      remove();
    }
  };

  // srcdoc before insertion, so the content load is the first real navigation
  // rather than a second one racing the blank pass above.
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

/** True for the implicit about:blank document an inserted iframe starts with. */
function isBlank(win: Window): boolean {
  try {
    if (win.location.href === "about:blank") return true;
    return !win.document.body || win.document.body.childElementCount === 0;
  } catch {
    // Unreadable means it is not our srcdoc document; treat it as not ready.
    return true;
  }
}

/**
 * Print rendered prose.
 *
 * `node` is the live element the panel is already showing. Taking its
 * `innerHTML` is what makes this work with no second Markdown implementation:
 * react-markdown produced that markup, so the printed document and the on-screen
 * one cannot drift apart.
 */
export function printRenderedNode(node: HTMLElement, title: string, mode: PrintMode): void {
  printHtmlDocument(printDocumentHtml({ bodyHtml: node.innerHTML, title, mode }));
}

/** Ask a sandboxed artifact frame to print itself. */
export function requestFramePrint(frame: HTMLIFrameElement): void {
  // targetOrigin "*" for the same reason the storage bridge uses it: the frame's
  // origin is "null" and cannot be named. The message carries no data.
  frame.contentWindow?.postMessage({ protocol: PRINT_PROTOCOL }, "*");
}

/**
 * The print shim injected into an artifact document.
 *
 * Only `parent` may ask, and the message carries nothing but the protocol tag,
 * so the worst an unrelated frame could achieve by guessing it is a print dialog
 * the user dismisses. The page CSS is appended rather than replacing the
 * artifact's own: a generated page is designed for a screen, and forcing white
 * paper on it would silently discard the design the user is looking at.
 */
export function printClientScript(): string {
  return `<script>(function(){
  var P=${JSON.stringify(PRINT_PROTOCOL)};
  window.addEventListener('message',function(e){
    if(e.source!==parent)return;
    var d=e.data;
    if(!d||d.protocol!==P)return;
    try{
      if(!document.getElementById('__atlas_print_css')){
        var s=document.createElement('style');
        s.id='__atlas_print_css';
        s.textContent='@page{size:A4;margin:12mm}@media print{html,body{height:auto!important;overflow:visible!important}}';
        document.head.appendChild(s);
      }
      window.focus();window.print();
    }catch(err){}
  });
})();<\/script>`;
}
