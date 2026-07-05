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
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
    signal,
  });

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
