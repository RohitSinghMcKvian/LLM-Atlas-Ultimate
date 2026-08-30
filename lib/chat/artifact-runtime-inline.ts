/**
 * Getting the vendored runtime into an artifact that cannot fetch it.
 *
 * The artifact frame is deliberately origin-isolated — `sandbox="allow-scripts"`
 * WITHOUT `allow-same-origin` — because that opaque origin is the whole
 * anti-exfiltration boundary (see `lib/chat/artifact-sandbox.ts`). The runtime it
 * needs is served from Atlas's own origin as `<script src>` tags, which is
 * correct in production and silently impossible in local development:
 *
 * **Chrome treats an opaque-origin document as `public` address space, and
 * Private Network Access blocks a `public → local` subresource request.** The
 * request is refused before it is dispatched, so it never reaches the server and
 * produces no console diagnostic — only a bare `error` event on the element.
 *
 * Measured on a running dev server, three ways:
 *
 * | frame                                     | `typeof AtlasShims` |
 * | ----------------------------------------- | ------------------- |
 * | `sandbox="allow-scripts"` (what we ship)  | `undefined`         |
 * | `sandbox="allow-scripts allow-same-origin"` | `object`          |
 * | no sandbox attribute                      | `object`            |
 *
 * …with the file returning 200 to `curl` throughout, no CSP involved (it fails
 * with the meta tag removed too), and the dev server logging zero requests for
 * `/artifact-runtime/`.
 *
 * The consequence was every artifact broken on `localhost`: a plain page lost
 * `atlas-shims.js` and reported it as the *model's* fault, and a React artifact
 * lost `react.js`, `react-dom.js` and `babel.js` and rendered nothing at all. It
 * survived because it cannot reproduce on a public HTTPS origin, which is where
 * anyone would have looked.
 *
 * The fix is not to relax the sandbox — that trades a real security property for
 * a development convenience. It is to stop needing the network: the parent
 * document *can* read these files (it is same-origin to them), so it reads them
 * once and pastes them into the document as inline `<script>` bodies. The CSP
 * already allows `'unsafe-inline'`, so nothing about the policy changes.
 *
 * Everything here is pure. The fetching and caching live at the call site; this
 * module only decides *whether*, *which*, and *how to splice* — which are the
 * three things worth testing.
 */

/** Path prefix every vendored runtime file is served under. */
const RUNTIME_PREFIX = "/artifact-runtime/";

/**
 * Hosts that live in the `local` or `private` address space.
 *
 * Matching the address space rather than the scheme: `http://192.168.1.9:3000`
 * on a phone hits exactly the same block as `localhost` does, and a developer
 * testing responsive layouts over the LAN is the second most likely person to
 * meet this bug.
 */
const PRIVATE_HOST =
  /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|.*\.local)$/i;

/**
 * Whether artifacts served from this origin must carry their runtime inline.
 *
 * False for anything that is not obviously private, so production takes the
 * unchanged `<script src>` path and pays nothing. An unparseable origin is
 * treated as public for the same reason: the linked path is the one we know
 * works, so it is the safer default when we cannot tell.
 */
export function needsInlineRuntime(origin: string): boolean {
  if (!origin) return false;
  try {
    return PRIVATE_HOST.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * The runtime files a built document links, in the order it links them.
 *
 * Order matters and is preserved: `atlas-shims.js` defines the lowercase
 * `window.react` alias that lucide-react reads at parse time, and swapping two
 * tags here would break a page that currently works.
 */
export function runtimeFilesIn(doc: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*\bsrc="[^"]*\/artifact-runtime\/([A-Za-z0-9._-]+)"[^>]*>\s*<\/script>/g;
  for (const m of doc.matchAll(re)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Make a script body safe to sit between `<script>` and `</script>`.
 *
 * An HTML parser ends a script at the first literal `</script`, wherever it
 * appears — including inside a string or a comment. Several of the vendored
 * bundles contain exactly that (`babel.js` writes `</script>` in its own error
 * text), so pasting one in unescaped would terminate the tag early and spill the
 * rest of a megabyte-long bundle into the page as text.
 *
 * `<\/script` is the standard escape: identical to JavaScript, invisible to the
 * HTML parser.
 */
export function escapeScriptBody(code: string): string {
  return code.replace(/<\/(script)/gi, "<\\/$1");
}

/**
 * Replace linked runtime tags with inline ones.
 *
 * A file missing from `sources` keeps its `<script src>` tag rather than being
 * dropped: a tag that fails to load reports itself through the error bridge,
 * where a silently removed one would surface later as `React is not defined` and
 * send the repair loop after the model's code for a fault that is ours.
 *
 * Idempotent — a document with no linked runtime tags is returned unchanged, by
 * identity — so it is safe to apply to an already-inlined document.
 */
export function inlineRuntimeScripts(
  doc: string,
  sources: ReadonlyMap<string, string>,
): string {
  if (!sources.size) return doc;
  let touched = false;
  const out = doc.replace(
    /<script\b[^>]*\bsrc="[^"]*\/artifact-runtime\/([A-Za-z0-9._-]+)"[^>]*>\s*<\/script>/g,
    (tag, file: string) => {
      const code = sources.get(file);
      if (code == null) return tag;
      touched = true;
      return `<script data-atlas-runtime="${file}">${escapeScriptBody(code)}</script>`;
    },
  );
  return touched ? out : doc;
}

/** The URL a runtime file is served from, for the caller that fetches it. */
export function runtimeUrl(origin: string, file: string): string {
  return `${origin}${RUNTIME_PREFIX}${file}`;
}
