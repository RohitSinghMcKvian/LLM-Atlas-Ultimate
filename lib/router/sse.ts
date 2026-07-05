/** Format a JSON event as an SSE frame. */
export function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;
