// A small, deliberately forgiving XML reader for syndication feeds.
//
// WHY NOT A LIBRARY
//
// Three reasons, in order of weight:
//
// 1. We need to be *wrong* in specific ways. Real feeds ship bare `&` inside
//    query strings, unclosed `<br>`, and mismatched nesting. A conforming parser
//    throws on those, and a thrown parse means a whole source contributes
//    nothing for an hour. This one recovers and returns whatever it managed to
//    read, because a partial feed is worth far more than an exception.
//
// 2. Security is easier to guarantee than to audit. Entity expansion is simply
//    never implemented here, so XXE and the billion-laughs class of attack
//    cannot exist. Establishing that about a third-party parser — and keeping it
//    established across upgrades — is more work than writing this file.
//
// 3. Scope. Feed XML is a closed subset: elements, attributes, text, CDATA,
//    comments, and one namespace convention. That is what is below.
//
// The repo already sets this precedent: `app/api/v1/search/route.ts` hand-parses
// HTML rather than adding cheerio.
//
// The parse is iterative with an explicit stack. Deeply nested (or maliciously
// nested) input must not be able to overflow the call stack — a crash in a
// background sync is much harder to notice than a truncated feed.

/** `local` of the synthetic nodes that carry character data. */
export const TEXT_NODE = "#text";

export interface XmlNode {
  /** Qualified name as written, e.g. `media:content`. */
  name: string;
  /** Local name, lowercased, namespace prefix removed — what you match on. */
  local: string;
  /** Attribute keys are lowercased and stripped of their prefix, same as `local`. */
  attrs: Record<string, string>;
  /**
   * Element children *and* `#text` nodes, in document order.
   *
   * Text is a child rather than a single field on the parent because ordering is
   * load-bearing: `<title>Claude <em>Opus</em> ships</title>` must read back as
   * one headline in the right order, not "Claude ships" with the emphasised word
   * appended at the end. `children()` and `child()` filter `#text` out, so callers
   * that only want elements never see them.
   */
  children: XmlNode[];
  /** This node's own direct character data, concatenated. Use `textOf` for the subtree. */
  text: string;
}

export interface XmlLimits {
  /** Input is hard-truncated to this many characters before parsing. */
  maxChars?: number;
  maxNodes?: number;
  maxDepth?: number;
  /**
   * Local names that may not contain themselves. Opening one while another is
   * still open closes the outer one instead of nesting.
   *
   * This exists for a specific, common defect: a feed that forgets `</item>`
   * makes every subsequent item a *child* of the first, so a 40-item feed parses
   * as one item and 39 disappear. Since `<item>` inside `<item>` is meaningless
   * in every feed flavour, treating the second one as a sibling recovers the
   * whole document. Deliberately opt-in and narrow — a general "unclosed tags
   * auto-close" rule would mangle legitimately nested content.
   */
  autoCloseSiblings?: readonly string[];
}

export interface XmlParseResult {
  root: XmlNode | null;
  /** A limit was hit, so the tree is incomplete but still usable. */
  truncated: boolean;
}

const DEFAULT_LIMITS: Required<XmlLimits> = {
  // ~2 MB of markup. The largest well-behaved feed in the registry is a few
  // hundred KB; anything an order of magnitude past that is a bug or an attack.
  maxChars: 2_000_000,
  maxNodes: 20_000,
  maxDepth: 64,
  autoCloseSiblings: [],
};

// --- Entities ---------------------------------------------------------------
//
// The five predefined entities and numeric character references. Nothing else.
// A `&foo;` that is not in this table is left exactly as written rather than
// looked up, because "looked up" is precisely the feature that makes XXE
// possible.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/**
 * Decode the entities we recognise, leave everything else verbatim.
 *
 * The bare-`&` case is the one that matters in practice: publishers routinely
 * emit `?a=1&b=2` unescaped in a link, which is invalid XML. Because this only
 * rewrites complete, recognised references, such a `&` simply survives as text.
 */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;

  return input.replace(ENTITY_RE, (match, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Reject surrogates, out-of-range values, and NUL — `fromCodePoint` throws
      // on those, and a throw here would take down the whole feed.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named ?? match;
  });
}

// --- Parser -----------------------------------------------------------------

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

function localName(qualified: string): string {
  const colon = qualified.indexOf(":");
  const bare = colon >= 0 ? qualified.slice(colon + 1) : qualified;
  return bare.toLowerCase();
}

function isNameStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

/** Skip an opaque `<! ... >` span, tracking an internal subset's brackets. */
function skipDeclaration(src: string, start: number): number {
  let depth = 0;
  for (let i = start + 2; i < src.length; i++) {
    const ch = src[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ">" && depth <= 0) return i + 1;
  }
  return src.length;
}

export function parseXml(src: string, limits: XmlLimits = {}): XmlParseResult {
  const { maxChars, maxNodes, maxDepth, autoCloseSiblings } = { ...DEFAULT_LIMITS, ...limits };
  const autoClose = new Set(autoCloseSiblings);

  let truncated = false;
  let input = src;
  if (input.length > maxChars) {
    input = input.slice(0, maxChars);
    truncated = true;
  }
  // A BOM ahead of the declaration is common enough to be worth handling; it
  // would otherwise make the first `<` not be at index 0 and confuse nothing at
  // all, but it does end up prepended to the first text node.
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);

  let root: XmlNode | null = null;
  const stack: XmlNode[] = [];
  let nodeCount = 0;
  let i = 0;

  const top = (): XmlNode | undefined => stack[stack.length - 1];

  const addText = (raw: string): void => {
    const parent = top();
    if (!parent || !raw) return;
    parent.text += raw;

    // Merge into the trailing text node when there is one, so the thousands of
    // whitespace chunks between elements in a pretty-printed feed cost a handful
    // of nodes rather than one each. Text nodes deliberately do NOT count
    // against `maxNodes` — that budget is about element structure.
    const last = parent.children[parent.children.length - 1];
    if (last && last.local === TEXT_NODE) {
      last.text += raw;
      return;
    }
    parent.children.push({
      name: TEXT_NODE,
      local: TEXT_NODE,
      attrs: {},
      children: [],
      text: raw,
    });
  };

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt < 0) {
      addText(decodeEntities(input.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(input.slice(i, lt)));

    // --- Comment ---
    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      i = end < 0 ? input.length : end + 3;
      continue;
    }

    // --- CDATA: raw text, no entity decoding ---
    if (input.startsWith("<![CDATA[", lt)) {
      const end = input.indexOf("]]>", lt + 9);
      addText(end < 0 ? input.slice(lt + 9) : input.slice(lt + 9, end));
      i = end < 0 ? input.length : end + 3;
      continue;
    }

    // --- DOCTYPE and other declarations: skipped as an opaque span ---
    //
    // This is the XXE defence, and it is a deletion rather than an addition: the
    // internal subset is never read, so an `<!ENTITY xxe SYSTEM "file:///etc/passwd">`
    // declaration is discarded along with everything else between the brackets,
    // and the `&xxe;` that would reference it is left as literal text by
    // `decodeEntities`.
    if (input.startsWith("<!", lt)) {
      i = skipDeclaration(input, lt);
      continue;
    }

    // --- Processing instruction, incl. the XML declaration ---
    if (input.startsWith("<?", lt)) {
      const end = input.indexOf("?>", lt + 2);
      i = end < 0 ? input.length : end + 2;
      continue;
    }

    // --- Closing tag ---
    if (input.startsWith("</", lt)) {
      const end = input.indexOf(">", lt + 2);
      const name = (end < 0 ? input.slice(lt + 2) : input.slice(lt + 2, end)).trim();
      const local = localName(name);

      // Recovery: an unclosed element earlier in the document means the top of
      // the stack is not what is closing. Look down for a match and unwind to
      // it; if there is no match at all the tag is stray, and ignoring it is
      // better than discarding a level of real structure.
      let depth = -1;
      for (let d = stack.length - 1; d >= 0; d--) {
        if (stack[d].local === local) {
          depth = d;
          break;
        }
      }
      if (depth >= 0) stack.length = depth;

      i = end < 0 ? input.length : end + 1;
      continue;
    }

    // --- Opening tag ---
    let p = lt + 1;
    if (p >= input.length || !isNameStart(input[p])) {
      // A `<` that starts nothing — an unescaped less-than in prose. Keep it.
      addText("<");
      i = lt + 1;
      continue;
    }

    const nameStart = p;
    while (p < input.length && !WHITESPACE.has(input[p]) && input[p] !== ">" && input[p] !== "/") {
      p++;
    }
    const name = input.slice(nameStart, p);

    // Attributes. Scanned character by character rather than with a regex,
    // because `>` inside a quoted value is legal and common in feed markup.
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    while (p < input.length) {
      while (p < input.length && WHITESPACE.has(input[p])) p++;
      if (p >= input.length) break;

      if (input[p] === ">") {
        p++;
        break;
      }
      if (input[p] === "/") {
        selfClosing = true;
        p++;
        continue;
      }

      const keyStart = p;
      while (
        p < input.length &&
        !WHITESPACE.has(input[p]) &&
        input[p] !== "=" &&
        input[p] !== ">" &&
        input[p] !== "/"
      ) {
        p++;
      }
      const rawKey = input.slice(keyStart, p);
      if (!rawKey) {
        p++;
        continue;
      }

      while (p < input.length && WHITESPACE.has(input[p])) p++;

      let value = "";
      if (input[p] === "=") {
        p++;
        while (p < input.length && WHITESPACE.has(input[p])) p++;
        const quote = input[p];
        if (quote === '"' || quote === "'") {
          p++;
          const valueStart = p;
          while (p < input.length && input[p] !== quote) p++;
          value = input.slice(valueStart, p);
          p++;
        } else {
          // Unquoted attribute value — invalid XML, but publishers emit it.
          const valueStart = p;
          while (p < input.length && !WHITESPACE.has(input[p]) && input[p] !== ">") p++;
          value = input.slice(valueStart, p);
        }
      }

      attrs[localName(rawKey)] = decodeEntities(value);
    }

    if (nodeCount >= maxNodes) {
      truncated = true;
      break;
    }
    nodeCount++;

    const local = localName(name);

    // Self-nesting recovery, before the parent is resolved — see
    // `autoCloseSiblings`. A feed that forgot `</item>` otherwise parses as a
    // single item with everything else buried inside it.
    if (autoClose.has(local)) {
      for (let d = stack.length - 1; d >= 0; d--) {
        if (stack[d].local === local) {
          stack.length = d;
          break;
        }
      }
    }

    const node: XmlNode = { name, local, attrs, children: [], text: "" };
    const parent = top();
    if (parent) parent.children.push(node);
    else if (!root) root = node;
    else {
      // A second top-level element. Malformed, but the first root is the one
      // that matters — everything after it is dropped rather than reparented.
      i = p;
      continue;
    }

    if (!selfClosing) {
      if (stack.length >= maxDepth) {
        // Refuse to descend further, but keep reading siblings at this level.
        truncated = true;
      } else {
        stack.push(node);
      }
    }

    i = p;
  }

  return { root, truncated };
}

// --- Navigation helpers -----------------------------------------------------
//
// All matching is on `local`, so a feed that namespaces `<dc:date>` and one that
// writes `<date>` are read by the same call.

/** Element children only — `#text` nodes are never returned by these helpers. */
export function elements(node: XmlNode | null | undefined): XmlNode[] {
  if (!node) return [];
  return node.children.filter((c) => c.local !== TEXT_NODE);
}

/** First direct element child matching any of the given local names, in preference order. */
export function child(node: XmlNode | null | undefined, ...localNames: string[]): XmlNode | undefined {
  if (!node) return undefined;
  for (const want of localNames) {
    const found = node.children.find((c) => c.local === want && c.local !== TEXT_NODE);
    if (found) return found;
  }
  return undefined;
}

/** Every direct element child with the given local name. */
export function children(node: XmlNode | null | undefined, localName: string): XmlNode[] {
  if (localName === TEXT_NODE) return [];
  if (!node) return [];
  return node.children.filter((c) => c.local === localName);
}

/** Subtree text in document order, without the outer trim. */
function rawTextOf(node: XmlNode): string {
  if (node.local === TEXT_NODE) return node.text;
  let out = "";
  for (const c of node.children) out += rawTextOf(c);
  return out;
}

/**
 * The node's text content including descendants', in document order, trimmed
 * once at the end.
 *
 * Trimming only at the end is deliberate — trimming per node would delete the
 * space before `<em>` and read "Claude Opusships".
 */
export function textOf(node: XmlNode | null | undefined): string {
  if (!node) return "";
  return rawTextOf(node).trim();
}

/** An attribute value by local name, or `""`. */
export function attr(node: XmlNode | null | undefined, name: string): string {
  return node?.attrs[name.toLowerCase()] ?? "";
}

/** Breadth-first search for the first descendant element with the given local name. */
export function findDescendant(node: XmlNode | null | undefined, localName: string): XmlNode | undefined {
  if (!node) return undefined;
  const queue: XmlNode[] = elements(node);
  while (queue.length) {
    const next = queue.shift()!;
    if (next.local === localName) return next;
    queue.push(...elements(next));
  }
  return undefined;
}
