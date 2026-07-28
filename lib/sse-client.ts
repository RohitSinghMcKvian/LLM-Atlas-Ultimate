"use client";

export class SSEHttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * POST a JSON body and consume the SSE response as parsed event objects.
 * Throws SSEHttpError on non-2xx (e.g. 503 when no provider is configured).
 */
export async function* postSSE<T = any>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): AsyncGenerator<T, void, unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    // A user abort must stay an abort — callers key off the name.
    if (signal?.aborted || (e as Error).name === "AbortError") throw e;
    // Otherwise the request never reached a server: the dev server is down, the
    // tab is on a stale port, or the network dropped. `fetch` reports all of
    // those as a bare `TypeError: Failed to fetch`, which surfaced verbatim in
    // the chat bubble and read like a model failure. Say what actually happened.
    throw new SSEHttpError(
      0,
      "Can't reach the Atlas server — the request never left the browser. Check that the dev server is running and that this tab is on the right port.",
      "network_unreachable",
    );
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const j = await res.json();
      message = j.error ?? message;
      code = j.code;
    } catch {
      /* non-JSON error */
    }
    throw new SSEHttpError(res.status, message, code);
  }
  if (!res.body) throw new SSEHttpError(500, "No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        yield JSON.parse(data) as T;
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
