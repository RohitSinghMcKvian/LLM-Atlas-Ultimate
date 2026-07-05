import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keyless web search via DuckDuckGo's HTML endpoint. No API key, no account, and
// nothing about the query is persisted or logged here — it's a pass-through that
// returns titles/urls/snippets for the model to cite (§4.6). If DDG changes its
// markup or rate-limits, we degrade to an empty result set rather than erroring.

interface Source {
  title: string;
  url: string;
  snippet: string;
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** DDG wraps outbound links; unwrap `/l/?uddg=<encoded>` to the real URL. */
function realUrl(href: string): string {
  try {
    const u = href.startsWith("http")
      ? new URL(href)
      : new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : u.toString();
  } catch {
    return href;
  }
}

function parse(html: string, limit: number): Source[] {
  const out: Source[] = [];
  // Each result: <a class="result__a" href="...">Title</a> … <a class="result__snippet">…</a>
  const linkRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe =
    /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const links: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && links.length < limit * 2) {
    links.push({ url: realUrl(m[1]), title: decode(m[2]) });
  }
  const snips: string[] = [];
  while ((m = snipRe.exec(html)) && snips.length < limit * 2) {
    snips.push(decode(m[1]));
  }
  for (let i = 0; i < links.length && out.length < limit; i++) {
    const { url, title } = links[i];
    if (!title || !url || url.includes("duckduckgo.com/y.js")) continue;
    out.push({ title, url, snippet: snips[i] ?? "" });
  }
  return out;
}

export async function POST(req: NextRequest) {
  let query = "";
  let count = 5;
  try {
    const body = await req.json();
    query = String(body.query ?? "").trim();
    if (typeof body.count === "number") count = Math.min(8, Math.max(1, body.count));
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!query) return Response.json({ sources: [] });

  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      },
      body: new URLSearchParams({ q: query }).toString(),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return Response.json({ sources: [] });
    const html = await res.text();
    return Response.json({ sources: parse(html, count) });
  } catch {
    // Timeout / network / markup change — never fail the chat over search.
    return Response.json({ sources: [] });
  }
}
