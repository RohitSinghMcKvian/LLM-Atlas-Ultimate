"use client";

import { beginRouterCall, type RouterCallRecorder } from "@/lib/router/telemetry";

/** The one route whose traffic the Router page reports on. */
const ROUTER_CHAT = "/api/v1/router/chat";

/**
 * Start recording, if this is an inference call.
 *
 * Every model call in the app comes through here, so this is the one place that
 * can see all of them. The alternative — asking eighteen call sites across Chat,
 * Code, Compare, Playground, Bench, Learn, Prompt and Orchestra to each report
 * their own traffic — is eighteen chances to forget one, and a Router page that
 * is quietly wrong about what the app is doing.
 *
 * Returns `undefined` for every other route, so nothing else pays for this.
 */
function tapRouterCall(url: string, body: unknown): RouterCallRecorder | undefined {
  if (!url.startsWith(ROUTER_CHAT)) return undefined;
  const modelId = (body as { modelId?: unknown } | null)?.modelId;
  if (typeof modelId !== "string" || !modelId) return undefined;
  try {
    return beginRouterCall(modelId);
  } catch {
    // Telemetry must never be able to break a request.
    return undefined;
  }
}

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
  const call = tapRouterCall(url, body);
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
    if (signal?.aborted || (e as Error).name === "AbortError") {
      call?.fail("aborted");
      throw e;
    }
    // Otherwise the request never reached a server: the dev server is down, the
    // tab is on a stale port, or the network dropped. `fetch` reports all of
    // those as a bare `TypeError: Failed to fetch`, which surfaced verbatim in
    // the chat bubble and read like a model failure. Say what actually happened.
    call?.fail("network unreachable");
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
    call?.fail(message);
    throw new SSEHttpError(res.status, message, code);
  }
  if (!res.body) {
    call?.fail("No response body");
    throw new SSEHttpError(500, "No response body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
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
        let event: T;
        try {
          event = JSON.parse(data) as T;
        } catch {
          continue; /* ignore malformed frame */
        }
        if (call) record(call, event);
        yield event;
      }
    }
  } catch (e) {
    call?.fail((e as Error)?.message ?? "stream failed");
    throw e;
  } finally {
    // Also covers the consumer breaking out of its `for await`, which calls the
    // generator's `return()` and would otherwise leave the record streaming
    // forever. `finish()` no-ops on a record already closed as ok or error.
    call?.finish();
  }
}

/**
 * Fold one SSE frame into the call record.
 *
 * Reads the wire shape `app/api/v1/router/chat/route.ts` emits: `meta` carries
 * the provider actually serving the request — twice, when a free model falls
 * through to a backup after a 429 or 5xx — `delta` is a content token, and
 * `usage` closes the books.
 */
function record(call: RouterCallRecorder, event: unknown): void {
  const ev = event as {
    type?: string;
    provider?: string;
    message?: string;
    promptTokens?: number;
    completionTokens?: number;
  };
  try {
    switch (ev?.type) {
      case "meta":
        if (ev.provider) call.provider(ev.provider as never);
        break;
      case "delta":
        call.firstToken();
        break;
      case "usage":
        call.usage({
          promptTokens: ev.promptTokens,
          completionTokens: ev.completionTokens,
        });
        break;
      case "error":
        call.fail(ev.message ?? "error");
        break;
      case "done":
        call.finish();
        break;
    }
  } catch {
    /* telemetry must never break a stream */
  }
}
