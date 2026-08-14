import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The authored shim bundle (scripts/artifact-shims.js).
 *
 * It is plain browser JS rather than a module in `lib/`, because it is served to
 * the artifact frame as a `<script src>` — the frame is at an opaque origin and
 * cannot import anything. That makes it the one piece of runtime the type checker
 * and the rest of the suite never see, so it is evaluated here against a fake
 * `window` and asserted directly.
 *
 * Worth testing rather than eyeballing: `twMerge`'s conflict resolution has real
 * branching, and getting it wrong is silent. An over-merge drops a class the page
 * needed and the layout breaks with no error; an under-merge is invisible. The
 * cases below pin which way each family falls.
 */

interface Shims {
  clsx: { default: (...a: unknown[]) => string };
  twMerge: { twMerge: (...a: unknown[]) => string };
  nextLink: { default: (p: Record<string, unknown>) => unknown };
  nextImage: { default: (p: Record<string, unknown>) => unknown };
  nextNavigation: Record<string, (...a: unknown[]) => unknown>;
  nextFont: Record<string, unknown>;
  nextHead: { default: () => unknown };
}

/** A React stand-in that records what was created rather than rendering it. */
interface Created {
  tag: string;
  props: Record<string, unknown>;
  children: unknown[];
}

let shims: Shims;
let win: Record<string, unknown>;

function load(react: unknown): { shims: Shims; win: Record<string, unknown> } {
  const src = readFileSync(join(process.cwd(), "scripts", "artifact-shims.js"), "utf8");
  const w: Record<string, unknown> = { React: react };
  // The bundle is an IIFE that assigns `window.AtlasShims`. Given a `window` and
  // nothing else, it must not touch any other global — if it does, this throws.
  new Function("window", "URLSearchParams", "Proxy", src)(w, URLSearchParams, Proxy);
  return { shims: w.AtlasShims as Shims, win: w };
}

beforeAll(() => {
  const React = {
    createElement: (tag: string, props: Record<string, unknown>, ...children: unknown[]): Created => ({
      tag,
      props: props ?? {},
      children,
    }),
  };
  const loaded = load(React);
  shims = loaded.shims;
  win = loaded.win;
});

describe("the window.react alias", () => {
  it("aliases lowercase react onto React", () => {
    // lucide-react's UMD reads `globalThis.react`, lowercase, and React's UMD
    // sets `React`. Without this line every lucide icon threw on `i.forwardRef`
    // the moment the script parsed.
    expect(win.react).toBe(win.React);
  });

  it("does not clobber an existing lowercase react", () => {
    const sentinel = { mine: true };
    const w: Record<string, unknown> = { React: {}, react: sentinel };
    const src = readFileSync(join(process.cwd(), "scripts", "artifact-shims.js"), "utf8");
    new Function("window", "URLSearchParams", "Proxy", src)(w, URLSearchParams, Proxy);
    expect(w.react).toBe(sentinel);
  });
});

describe("every shim is an ES module namespace", () => {
  it("marks __esModule so the require registry passes it through", () => {
    // registryRuntime wraps a non-__esModule value as `{ default: value }`, which
    // would make `import { useRouter } from "next/navigation"` undefined.
    for (const [name, mod] of Object.entries(shims)) {
      expect((mod as { __esModule?: boolean }).__esModule, name).toBe(true);
    }
  });

  it("gives a default export to every module imported by default", () => {
    for (const name of ["clsx", "twMerge", "nextLink", "nextImage", "nextHead"] as const) {
      expect(shims[name], name).toHaveProperty("default");
    }
  });
});

describe("clsx", () => {
  const cx = (...a: unknown[]) => shims.clsx.default(...a);

  it("joins strings and skips falsy values", () => {
    expect(cx("a", null, undefined, false, "", "b")).toBe("a b");
  });

  it("takes the truthy keys of an object", () => {
    expect(cx({ a: true, b: false, c: 1 })).toBe("a c");
  });

  it("flattens nested arrays", () => {
    expect(cx(["a", ["b", { c: true }]], "d")).toBe("a b c d");
  });

  it("returns an empty string for nothing", () => {
    expect(cx()).toBe("");
    expect(cx(null, false)).toBe("");
  });
});

describe("twMerge", () => {
  const tw = (...a: unknown[]) => shims.twMerge.twMerge(...a);

  it("lets a later utility win within one family", () => {
    expect(tw("px-4", "px-2")).toBe("px-2");
    expect(tw("w-full w-1/2")).toBe("w-1/2");
  });

  it("collides colors across different scales", () => {
    // The case a naive last-segment key gets wrong: `bg-red` and `bg-blue` look
    // like different families until you know the last segment is a shade.
    expect(tw("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
    expect(tw("bg-red-500", "bg-white")).toBe("bg-white");
    expect(tw("text-slate-100", "text-emerald-400")).toBe("text-emerald-400");
  });

  it("keeps font-size and text color apart", () => {
    // Both start `text-`, and merging them would drop one of two properties.
    expect(tw("text-sm", "text-red-500").split(" ").sort()).toEqual(["text-red-500", "text-sm"]);
  });

  it("keeps border width and border color apart", () => {
    expect(tw("border-2", "border-red-500").split(" ").sort()).toEqual([
      "border-2",
      "border-red-500",
    ]);
  });

  it("treats a variant as part of the group", () => {
    const out = tw("bg-red-500", "hover:bg-blue-500");
    expect(out).toContain("bg-red-500");
    expect(out).toContain("hover:bg-blue-500");
    expect(tw("hover:bg-red-500", "hover:bg-blue-500")).toBe("hover:bg-blue-500");
  });

  it("keeps single-word utilities and distinct families", () => {
    expect(tw("flex items-center gap-4")).toBe("flex items-center gap-4");
  });

  it("handles negative utilities without merging them into the positive one", () => {
    expect(tw("-mt-4", "-mt-2")).toBe("-mt-2");
    const mixed = tw("mt-4", "-mt-2");
    expect(mixed).toContain("-mt-2");
  });

  it("does not merge an arbitrary value into a scale value", () => {
    // Under-merging on purpose: keeping both is invisible, dropping the wrong one
    // is a visible break.
    expect(tw("bg-code", "bg-red-500").split(" ")).toHaveLength(2);
  });

  it("preserves first-seen order while taking the last value", () => {
    expect(tw("px-4 text-sm px-2")).toBe("px-2 text-sm");
  });

  it("accepts the conditional forms clsx does", () => {
    expect(tw("px-4", { "px-2": true, "px-8": false })).toBe("px-2");
  });
});

describe("next/link", () => {
  const render = (p: Record<string, unknown>) => shims.nextLink.default(p) as Created;

  it("renders an anchor carrying the href", () => {
    const el = render({ href: "/about", children: "About" });
    expect(el.tag).toBe("a");
    expect(el.props.href).toBe("/about");
    expect(el.children).toEqual(["About"]);
  });

  it("flattens an object href into a query string", () => {
    const el = render({ href: { pathname: "/p", query: { a: "1", b: "2" } } });
    expect(el.props.href).toBe("/p?a=1&b=2");
  });

  it("drops Next-only props that would warn on a DOM node", () => {
    const el = render({ href: "/", prefetch: false, replace: true, scroll: false, className: "x" });
    expect(el.props).not.toHaveProperty("prefetch");
    expect(el.props).not.toHaveProperty("replace");
    expect(el.props.className).toBe("x");
  });
});

describe("next/image", () => {
  const render = (p: Record<string, unknown>) => shims.nextImage.default(p) as Created;

  it("renders an img and always supplies alt", () => {
    const el = render({ src: "/a.png" });
    expect(el.tag).toBe("img");
    expect(el.props.alt).toBe("");
  });

  it("turns fill into absolute positioning rather than an attribute", () => {
    // `fill` is a layout mode; passed through it would be an invalid attribute
    // and the image would collapse to its intrinsic size.
    const el = render({ src: "/a.png", fill: true, width: 10, height: 10 });
    const style = el.props.style as Record<string, unknown>;
    expect(style.position).toBe("absolute");
    expect(style.objectFit).toBe("cover");
    expect(el.props).not.toHaveProperty("width");
    expect(el.props).not.toHaveProperty("fill");
  });

  it("keeps an explicit objectFit the page chose", () => {
    const el = render({ src: "/a.png", fill: true, style: { objectFit: "contain" } });
    expect((el.props.style as Record<string, unknown>).objectFit).toBe("contain");
  });
});

describe("next/navigation", () => {
  it("returns a router whose methods are callable no-ops", () => {
    const router = shims.nextNavigation.useRouter() as Record<
      string,
      (...a: unknown[]) => unknown
    >;
    // A page that wires onClick to router.push must not throw on the first click.
    expect(() => router.push("/x")).not.toThrow();
    expect(() => router.back()).not.toThrow();
  });

  it("returns a real URLSearchParams so .get() works", () => {
    const params = shims.nextNavigation.useSearchParams() as URLSearchParams;
    expect(params.get("missing")).toBeNull();
    expect(typeof params.has).toBe("function");
  });

  it("returns a pathname and empty params", () => {
    expect(shims.nextNavigation.usePathname()).toBe("/");
    expect(shims.nextNavigation.useParams()).toEqual({});
  });
});

describe("next/font", () => {
  it("answers any capitalized font name with a loader", () => {
    // ~1500 Google fonts exist; an enumerated object would always miss the one
    // this artifact wanted. Orbitron and Space_Grotesk are what space-themed
    // pages actually ask for.
    for (const name of ["Inter", "Orbitron", "Space_Grotesk", "Roboto_Mono"]) {
      const loader = shims.nextFont[name] as (o?: unknown) => Record<string, unknown>;
      expect(typeof loader, name).toBe("function");
      expect(loader({ subsets: ["latin"] })).toHaveProperty("className");
    }
  });

  it("inherits the document font rather than guessing a fallback", () => {
    const font = (shims.nextFont.Orbitron as () => Record<string, unknown>)();
    expect((font.style as Record<string, unknown>).fontFamily).toBe("inherit");
    expect(font.className).toBe("");
  });

  it("leaves a lowercase probe undefined so it is not taken for a thenable", () => {
    // Babel's interop and `await` both probe `.then`; returning a function there
    // would make the namespace look like a promise.
    expect(shims.nextFont.then).toBeUndefined();
    expect(shims.nextFont.default).toBeTypeOf("function");
  });
});
