// Stand-ins for bare specifiers that have no UMD build to vendor.
//
// The artifact sandbox has `connect-src 'none'` and whitelists only Atlas's own
// origin, so there is no npm to fall back to: a specifier is either a workspace
// file, a vendored global, or a bundle error the user sees. React, Recharts,
// three.js and friends all ship UMD builds, so they are copied straight out of
// node_modules. These do not:
//
//   - `next/*` is a framework, not a library. There is no build of `next/link`
//     that runs standalone in a page, and there never will be.
//   - `clsx` and `tailwind-merge` ship ESM/CJS only.
//
// Models write all of them anyway — ask for a landing page and you get
// `next/link`, `next/image` and `twMerge` whatever the system prompt says. Every
// one of those was a fatal `cannot resolve import` that stopped the whole bundle.
// So each gets the smallest honest stand-in that makes the page render.
//
// These are deliberately NOT faithful implementations. An artifact is a preview
// in a sandboxed frame: there is no router to push to, no image optimizer, and
// no font server to fetch from. A `<Link>` that renders an `<a>` and a
// `useRouter()` whose `push` does nothing are the correct behaviour here, and
// pretending otherwise would fail in stranger ways than not existing at all.
//
// Source of truth for this file is scripts/artifact-shims.js; it is copied to
// public/artifact-runtime/atlas-shims.js by scripts/vendor-artifact-runtime.mjs,
// because that whole directory is generated and gitignored.
(function () {
  "use strict";

  // ── window.react, lowercase ────────────────────────────────────────────────
  //
  // Not a shim: a fix for a mismatch between two vendored UMD builds.
  //
  // lucide-react's UMD resolves React as `globalThis.react` — lowercase — in its
  // browser-global branch:
  //
  //   (a = globalThis, i(a.LucideReact = {}, a.react))
  //
  // React's own UMD sets `globalThis.React`. Nothing sets `react`. So the factory
  // received `undefined` and threw on `i.forwardRef` the moment the script
  // parsed, which meant *every* lucide icon in *every* artifact failed at load
  // time — reported as an unhelpful "Script error." or as the icon simply being
  // undefined at the point of use.
  //
  // Aliased rather than patched in the vendored file, because that file is
  // regenerated from node_modules on every install.
  if (window.React && !window.react) window.react = window.React;

  // React is loaded by an earlier <script> tag, but read lazily anyway: these
  // are only ever called during render, and a load-time reference would make
  // script order load-bearing for no benefit.
  function h() {
    var R = window.React;
    if (!R) throw new Error("React is not loaded");
    return R.createElement.apply(R, arguments);
  }

  /**
   * Mark an object as an ES module namespace.
   *
   * The bundler's `require` registry (registryRuntime in lib/chat/artifact-bundle.ts)
   * passes an object straight through when `__esModule` is set, and otherwise
   * wraps it as `{ default: value }`. Setting it here is what makes both
   * `import Link from "next/link"` and `import { useRouter } from "next/navigation"`
   * resolve off one object.
   */
  function ns(exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    return exports;
  }

  // ── clsx / classnames ──────────────────────────────────────────────────────

  function clsx() {
    var out = "";
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (!a) continue;
      var s = "";
      if (typeof a === "string" || typeof a === "number") s = String(a);
      else if (Array.isArray(a)) s = clsx.apply(null, a);
      else if (typeof a === "object") {
        var on = [];
        for (var k in a) if (a[k]) on.push(k);
        s = on.join(" ");
      }
      if (s) out += (out ? " " : "") + s;
    }
    return out;
  }

  // ── tailwind-merge ─────────────────────────────────────────────────────────

  // Families whose value is a color. Needed because a color has two value
  // segments (`red-500`) while everything else has one (`sm`, `4`, `full`), so
  // one grouping rule cannot serve both.
  var COLOR_FAMILIES =
    /^(bg|text|border|ring|ring-offset|from|via|to|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder)-(.+)$/;
  // A color value: a named scale (`red-500`, `slate-50`) or a bare keyword.
  var COLOR_VALUE = /(^|-)(\d{2,3})$|^(white|black|transparent|current|inherit|none)$/;

  /**
   * Last-one-wins conflict resolution over Tailwind utilities.
   *
   * A plain join is not good enough to pass for `twMerge`, and the failure is
   * silent rather than loud: Tailwind's cascade resolves `px-2 px-4` by the order
   * the rules appear in the generated stylesheet, not by the order the classes
   * appear in the attribute. So `twMerge("px-4", "px-2")` returning both can
   * render the wrong padding, and the artifact looks subtly broken with no error.
   *
   * The rule errs toward **under**-merging, deliberately. Keeping a redundant
   * class is invisible; dropping a needed one is a visible break. So a case this
   * cannot classify falls through to "distinct group" rather than being guessed
   * into a merge.
   *
   * Two rules, because a color has one more value segment than anything else:
   *
   *  - A color family keeps only the family name, so `bg-red-500` and
   *    `bg-blue-500` collide as they should.
   *  - Everything else drops one segment, so `px-2`/`px-4`, `w-full`/`w-1/2` and
   *    `text-sm`/`text-lg` collide. `text-sm` and `text-red-500` do not, which is
   *    correct — they set font-size and color.
   *
   * The variant prefix is part of the key, so `hover:bg-red-500` never clobbers
   * `bg-red-500`. This is not the real library's conflict table — it does not know
   * that `p-4` subsumes `px-4` — but it covers the same-property case that is
   * nearly all real use.
   */
  function groupKey(cls) {
    var colon = cls.lastIndexOf(":");
    var variant = colon === -1 ? "" : cls.slice(0, colon + 1);
    var base = colon === -1 ? cls : cls.slice(colon + 1);
    var neg = base.charAt(0) === "-" ? "-" : "";
    if (neg) base = base.slice(1);

    var color = COLOR_FAMILIES.exec(base);
    if (color && COLOR_VALUE.test(color[2])) return variant + neg + color[1] + "-color";

    // Arbitrary values can contain dashes inside brackets: keep them whole.
    var bracket = base.indexOf("[");
    var head = bracket === -1 ? base : base.slice(0, bracket);
    var dash = head.lastIndexOf("-");
    // A single-word utility (`flex`, `truncate`) is its own group.
    return variant + neg + (dash === -1 ? head : head.slice(0, dash));
  }

  function twMerge() {
    var classes = clsx.apply(null, arguments).split(/\s+/).filter(Boolean);
    var seen = Object.create(null);
    var order = [];
    for (var i = 0; i < classes.length; i++) {
      var g = groupKey(classes[i]);
      if (!(g in seen)) order.push(g);
      seen[g] = classes[i]; // later wins
    }
    return order.map(function (g) { return seen[g]; }).join(" ");
  }

  // ── next/link, next/image ──────────────────────────────────────────────────

  // `href` may be an object (`{ pathname, query }`) in the pages router.
  function hrefToString(href) {
    if (typeof href === "string") return href;
    if (!href || typeof href !== "object") return "#";
    var q = "";
    if (href.query && typeof href.query === "object") {
      var parts = [];
      for (var k in href.query) {
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(href.query[k])));
      }
      if (parts.length) q = "?" + parts.join("&");
    }
    return String(href.pathname || "#") + q;
  }

  function Link(props) {
    var p = props || {};
    var rest = {};
    for (var k in p) {
      // Next-only props that would land on the DOM node and warn.
      if (k === "href" || k === "children" || k === "prefetch" || k === "replace" ||
          k === "scroll" || k === "shallow" || k === "passHref" || k === "locale" ||
          k === "legacyBehavior") continue;
      rest[k] = p[k];
    }
    rest.href = hrefToString(p.href);
    return h("a", rest, p.children);
  }

  function Image(props) {
    var p = props || {};
    var style = {};
    for (var s in (p.style || {})) style[s] = p.style[s];
    var rest = {};
    for (var k in p) {
      if (k === "fill" || k === "priority" || k === "quality" || k === "loader" ||
          k === "placeholder" || k === "blurDataURL" || k === "unoptimized" ||
          k === "sizes" || k === "loading" || k === "style" || k === "onLoadingComplete") continue;
      rest[k] = p[k];
    }
    // `fill` is a layout mode, not an attribute: it means "absolutely fill the
    // positioned ancestor", which is a style in plain HTML.
    if (p.fill) {
      style.position = "absolute";
      style.inset = 0;
      style.width = "100%";
      style.height = "100%";
      if (!style.objectFit) style.objectFit = "cover";
      delete rest.width;
      delete rest.height;
    }
    rest.style = style;
    if (!rest.alt) rest.alt = "";
    return h("img", rest);
  }

  // ── next/navigation, next/router ───────────────────────────────────────────
  //
  // There is nothing to navigate to. A no-op router is what keeps a page that
  // wires an onClick to `router.push` from throwing on the first click.

  function noop() {}
  var router = {
    push: noop, replace: noop, back: noop, forward: noop, refresh: noop,
    prefetch: noop, pathname: "/", route: "/", asPath: "/", query: {},
    events: { on: noop, off: noop, emit: noop },
    isReady: true, isFallback: false,
  };

  // URLSearchParams is a real browser class, so an empty one behaves correctly
  // for `.get()`, `.has()` and iteration without any stubbing.
  var emptyParams = new URLSearchParams("");

  var navigation = ns({
    useRouter: function () { return router; },
    usePathname: function () { return "/"; },
    useSearchParams: function () { return emptyParams; },
    useParams: function () { return {}; },
    useSelectedLayoutSegment: function () { return null; },
    useSelectedLayoutSegments: function () { return []; },
    redirect: noop,
    permanentRedirect: noop,
    notFound: noop,
  });

  // ── next/font ──────────────────────────────────────────────────────────────

  /**
   * Any font name, via a Proxy.
   *
   * `import { Orbitron } from "next/font/google"` can name any of ~1500 fonts,
   * so an enumerated object would always be missing the one this artifact wanted.
   * The `get` trap answers every capitalized identifier with a loader, which is
   * exactly the shape the call site expects: `Orbitron({ subsets: ["latin"] })`
   * returning something with a `className`.
   *
   * The returned className is empty rather than a generated one: there is no font
   * to serve (`connect-src 'none'`), so the honest result is that the element
   * keeps the document's own font stack instead of silently rendering in a
   * fallback the page did not choose.
   */
  function fontLoader() {
    return { className: "", style: { fontFamily: "inherit" }, variable: "" };
  }

  var fontModule = new Proxy(ns({ default: fontLoader }), {
    get: function (target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string") return undefined;
      // Font exports are capitalized (`Inter`, `Space_Grotesk`); anything else is
      // a runtime probe (`then`, `Symbol.toStringTag`) that must stay undefined
      // so the value is not mistaken for a thenable.
      return /^[A-Z]/.test(prop) ? fontLoader : undefined;
    },
  });

  // ── next/head, next/script ─────────────────────────────────────────────────
  //
  // Both render nothing. `<Head>` mutating the real <head> from inside a
  // component is not worth emulating, and `<Script src>` cannot load anything
  // under this CSP — dropping it silently is better than a resource error the
  // model then tries to "fix".

  function Head() { return null; }
  function Script() { return null; }

  window.AtlasShims = {
    clsx: ns({ default: clsx, clsx: clsx }),
    twMerge: ns({ default: twMerge, twMerge: twMerge, twJoin: clsx, cn: twMerge }),
    nextLink: ns({ default: Link }),
    nextImage: ns({ default: Image }),
    nextNavigation: navigation,
    nextRouter: ns({ default: router, useRouter: function () { return router; }, withRouter: function (C) { return C; } }),
    nextFont: fontModule,
    nextHead: ns({ default: Head }),
    nextScript: ns({ default: Script }),
  };
})();
