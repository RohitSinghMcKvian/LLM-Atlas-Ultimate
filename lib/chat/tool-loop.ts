import type { ToolDef } from "@/lib/router";
import { normalizeImageUrl } from "@/lib/router/images";
import type { StoredToolCall, WebSource } from "./types";
import type { ToolResult } from "./tools";
import { MAX_CONTINUATIONS, RESUME_INSTRUCTION, shouldContinue, stitch } from "./continuation";

/**
 * The agentic tool loop: stream → if the model asked for tools, run them, feed
 * the results back, stream again.
 *
 * Extracted from the chat client and given injected dependencies so it can be
 * tested. It has enough edge cases — multi-round, preamble text, partial
 * failure, abort mid-tool, the round cap — that leaving it inside a React
 * component (which this repo's node-only vitest setup cannot render) would mean
 * shipping the most intricate new logic in the phase untested.
 *
 * Knows nothing about React, the DOM, or fetch. Progress is reported through
 * callbacks; the caller decides how to coalesce it into renders.
 */

/** Wire events as the chat SSE endpoint emits them. */
export type WireEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "image"; url: string; mime?: string }
  | { type: "tool_call"; id: string; name: string; arguments?: string }
  | { type: "usage"; promptTokens?: number; completionTokens?: number; imageTokens?: number }
  | { type: "error"; message: string; code?: string }
  | { type: "meta"; provider?: string }
  /** The route refused something and the request was retried without it. */
  | { type: "capability"; capability: "tools"; supported: false }
  | { type: "done"; finishReason?: string };

/** Minimal message shape the loop appends to. Mirrors the OpenAI wire format. */
export interface LoopMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolLoopDeps {
  /** One streaming round. `tools` is undefined when none are offered. */
  stream: (messages: LoopMessage[], tools?: ToolDef[]) => AsyncIterable<WireEvent>;
  /**
   * Run a single tool. Should not throw except on abort.
   *
   * `callId` identifies which call is running, so a tool that streams — today
   * `run_python` — can route its output to the right step in the UI. Without it
   * a live terminal would be a post-hoc dump, which is the wrong shape for the
   * long analyses that make execution worth having.
   */
  runTool: (name: string, args: string, callId: string) => Promise<ToolResult>;
  /** Tools to offer. Empty disables the loop entirely. */
  toolDefs: ToolDef[];
  /** Cap on tool rounds. Required so a looping model can't burn the context window. */
  maxRounds?: number;
  /**
   * Cap on resume requests after a `finish_reason: "length"`. 0 disables
   * continuation entirely, which is what the short single-shot calls elsewhere
   * in the app want.
   */
  maxContinuations?: number;
  /**
   * Consulted before every round. A non-null result ends the loop and is
   * reported as `stoppedBy` / `stopReason`.
   *
   * A hook rather than more caps here because the interesting limits are not
   * countable by this module: wall-clock, money, and "has this build actually
   * produced anything in the last few rounds". `lib/chat/build-budget.ts` owns
   * those; the loop only needs to ask.
   *
   * The machine-readable `reason` travels with the message because the UI has to
   * offer a different control for each — a round cap is a Continue button, a
   * cost ceiling is a settings link, a detected loop is neither.
   */
  shouldStop?: () => { reason: string; message: string } | null;
  /**
   * Shrink the loop's own transcript before each round.
   *
   * The loop re-sends every prior round's tool calls and results on every
   * round, so round fifteen carries rounds one to fourteen in full — which is
   * the real ceiling on how long a build can run. `boundary` is where the
   * caller's history ends and the loop's own messages begin; nothing below it
   * may be touched.
   *
   * Optional and absent by default, so an unconfigured loop behaves exactly as
   * it did. `lib/chat/transcript-trim.ts` owns the rules.
   */
  trimTranscript?: (convo: LoopMessage[], boundary: number) => LoopMessage[];
}

export interface ToolLoopCallbacks {
  /** Full accumulated text so far for the current answer. */
  onText?: (text: string) => void;
  onReasoning?: (text: string) => void;
  /** Every tool call seen this turn, including results as they fill in. */
  onToolCalls?: (calls: StoredToolCall[]) => void;
  /** De-duplicated sources gathered across all rounds. */
  onSources?: (sources: WebSource[]) => void;
  onUsage?: (u: {
    promptTokens?: number;
    completionTokens?: number;
    imageTokens?: number;
  }) => void;
  onError?: (e: { message: string; code?: string }) => void;
  /** A truncated answer is being resumed. 1-based, so it reads "1 of 3". */
  onContinue?: (attempt: number, max: number) => void;
  /** Every image the model produced this turn, de-duplicated, as they arrive. */
  onImages?: (images: { url: string; mime?: string }[]) => void;
  /**
   * A round of tool execution finished. Carries the calls it made, so the caller
   * can judge whether the round accomplished anything — the loop cannot, because
   * "productive" depends on what the tools mean.
   */
  onRoundComplete?: (calls: StoredToolCall[]) => void;
  /**
   * How large the request has grown, in characters, after any trimming.
   *
   * The number that actually stops a long build. Reported every round so the
   * run panel can show it filling rather than the user discovering it as a
   * provider error on round eighteen.
   */
  onContextGrowth?: (chars: number) => void;
  /**
   * The route rejected a capability and the request was retried without it.
   *
   * Fired at most once per turn per capability. The caller is expected to both
   * tell the user and persist the fact — a rejection is the only trustworthy
   * evidence about a route, and re-offering tools every turn costs a wasted
   * round trip each time.
   */
  onCapability?: (capability: "tools", supported: false) => void;
}

export interface ToolLoopResult {
  /** The final answer, with any pre-tool preamble discarded. */
  content: string;
  reasoning: string;
  toolCalls: StoredToolCall[];
  sources: WebSource[];
  errored: boolean;
  /** Rounds of tool execution actually performed. */
  rounds: number;
  /** True when the cap stopped the loop rather than the model finishing. */
  hitRoundCap: boolean;
  /** Set when `shouldStop` ended the run; the reason, in words for the user. */
  stoppedBy?: string;
  /** The same stop, machine-readable, so the UI can offer the right control. */
  stopReason?: string;
  /** Resume requests made after a truncated answer, across all rounds. */
  continuations: number;
  /** Images the model produced, de-duplicated across rounds. */
  images: { url: string; mime?: string }[];
  /**
   * True when the answer is still short of what the model wanted to say: it was
   * truncated and the continuation cap was reached. The caller should say so
   * rather than present the fragment as finished.
   */
  truncated: boolean;
  /**
   * The provider stopped sending, mid-answer, without saying why.
   *
   * A different failure from `truncated`, and it must not be silent. Truncation
   * is the model reaching its output limit, which `stitch` and the resume loop
   * recover from. A stall is the connection going quiet past the idle timeout —
   * `shouldContinue` declines to resume it, correctly, because retrying a hung
   * connection is not this loop's job. But nothing else retried it either, so
   * the observed result was an empty assistant message and no explanation, after
   * two rounds and a written plan. Recorded here so the caller can at least say
   * what happened.
   */
  stalled: boolean;
  /**
   * The route refused the tools it was offered and the turn ran without them.
   * The answer is real, but it was produced with no tool access — which the
   * caller must say, and must remember for the next turn.
   */
  toolsRejected: boolean;
}

export const DEFAULT_MAX_TOOL_ROUNDS = 4;

/** Whole-request size, for the context meter. Counts what the wire will carry. */
function charsOfConvo(convo: LoopMessage[]): number {
  let n = 0;
  for (const m of convo) {
    n += typeof m.content === "string" ? m.content.length : charsOfUnknown(m.content);
    for (const c of m.tool_calls ?? []) n += c.function.name.length + c.function.arguments.length;
  }
  return n;
}

function charsOfUnknown(v: unknown): number {
  if (v == null) return 0;
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
}

export async function runToolLoop(
  initialMessages: LoopMessage[],
  deps: ToolLoopDeps,
  cb: ToolLoopCallbacks = {},
): Promise<ToolLoopResult> {
  const maxRounds = deps.maxRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const maxContinuations = deps.maxContinuations ?? MAX_CONTINUATIONS;
  const convo: LoopMessage[] = [...initialMessages];
  /**
   * Where the caller's messages end and the loop's own begin.
   *
   * Everything below this — the system prompt, the conversation history, the
   * search block — belongs to the caller and is never trimmed. Everything above
   * it the loop appended itself, and is fair game.
   */
  const boundary = convo.length;

  let content = "";
  let reasoning = "";
  let errored = false;
  let rounds = 0;
  let hitRoundCap = false;
  let stoppedBy: string | undefined;
  let stopReason: string | undefined;
  let continuations = 0;
  let truncated = false;
  let stalled = false;
  let toolsRejected = false;
  const toolCalls: StoredToolCall[] = [];
  const sources: WebSource[] = [];
  const images: { url: string; mime?: string }[] = [];

  const offersTools = deps.toolDefs.length > 0;

  for (let round = 0; ; round++) {
    // A budget stop is checked here rather than after the round, so the run ends
    // before spending on a request whose result it would refuse to act on.
    const stop = round > 0 ? deps.shouldStop?.() : null;
    if (stop) {
      stoppedBy = stop.message;
      stopReason = stop.reason;
    }
    // Withhold tools on the final permitted round: otherwise the model can end
    // the turn having asked for a call we then refuse to run, leaving the user
    // with a request and no answer. A budget stop withholds them for the same
    // reason — the model gets one last round to answer with what it has.
    const offerThisRound = offersTools && round < maxRounds && !stoppedBy && !toolsRejected;
    const roundCalls: StoredToolCall[] = [];
    // Only the final round's text survives (a tool round discards its preamble),
    // so only the final round's truncation is the one worth reporting.
    truncated = false;

    // Text for this round, split into what earlier resume attempts already
    // produced and what the current stream is producing. They are kept apart so
    // the seam between them can be de-duplicated by `stitch` — concatenating
    // blind would restate whatever line the model repeated for context.
    let committed = "";
    let segment = "";
    let resumes = 0;
    const merged = () => (resumes > 0 ? stitch(committed, segment) : committed + segment);

    // Shrink what the loop has accumulated, in place.
    //
    // In place, not on a copy: trimming a copy would leave the real transcript
    // growing underneath, so round twenty would trim from twenty rounds of raw
    // material every time and the saving would never compound. Safe because
    // `trimToolTranscript` is idempotent and returns its input by identity when
    // nothing changed.
    if (deps.trimTranscript) {
      const next = deps.trimTranscript(convo, boundary);
      if (next !== convo) {
        convo.length = 0;
        convo.push(...next);
      }
    }
    cb.onContextGrowth?.(charsOfConvo(convo));

    // The resume request carries the partial answer back as context, so it
    // cannot be appended to `convo` — that would make it part of the permanent
    // history the next tool round builds on.
    let streamMessages: LoopMessage[] = convo;

    for (;;) {
      let finishReason: string | undefined;

      for await (const ev of deps.stream(
        streamMessages,
        offerThisRound ? deps.toolDefs : undefined,
      )) {
        switch (ev.type) {
          case "delta":
            segment += ev.text;
            content = merged();
            cb.onText?.(content);
            break;
          case "reasoning":
            reasoning += ev.text;
            cb.onReasoning?.(reasoning);
            break;
          case "tool_call": {
            const call: StoredToolCall = {
              id: ev.id,
              name: ev.name,
              arguments: ev.arguments ?? "",
            };
            roundCalls.push(call);
            toolCalls.push(call);
            cb.onToolCalls?.([...toolCalls]);
            break;
          }
          case "image": {
            // Re-validated on the client, not only in the router that emitted
            // it. The URL ends up in an `<img src>` *and* in the download
            // button's `<a href>`, and a `javascript:` href executes — so
            // trusting the wire event because "it came from our own route"
            // would put the whole scheme allowlist behind a single hop. Found
            // live: an unvalidated `javascript:` URL rendered.
            const safe = normalizeImageUrl(ev.url, ev.mime);
            if (!safe) break;
            // De-duplicated here as well as in the router: a resumed turn
            // re-sends the whole message, images included.
            if (!images.some((i) => i.url === safe.url)) {
              images.push({ url: safe.url, mime: safe.mime || ev.mime });
              cb.onImages?.([...images]);
            }
            break;
          }
          case "usage":
            cb.onUsage?.({
              promptTokens: ev.promptTokens,
              completionTokens: ev.completionTokens,
              imageTokens: ev.imageTokens,
            });
            break;
          case "capability":
            // Reported once per turn. Also latched, so a resumed or subsequent
            // round does not re-send the tools this route has already refused
            // and pay for the downgrade round trip again.
            if (ev.capability === "tools" && !toolsRejected) {
              toolsRejected = true;
              cb.onCapability?.("tools", false);
            }
            break;
          case "error":
            errored = true;
            cb.onError?.({ message: ev.message, code: ev.code });
            break;
          case "done":
            finishReason = ev.finishReason;
            break;
          default:
            break; // meta carries no state the loop needs
        }
      }

      content = merged();

      // The provider went quiet past the idle timeout. Not resumable here — see
      // `shouldContinue` — but it must not pass for a finished answer, which is
      // exactly what it did: an empty message with nothing to explain it.
      if (finishReason === "stalled") stalled = true;

      // A truncated tool call is unusable — the arguments are half a JSON
      // object — so resuming is only meaningful for a plain answer.
      if (errored || roundCalls.length > 0) break;
      if (finishReason !== "length") break;
      if (!shouldContinue(finishReason, resumes, maxContinuations)) {
        // Out of resume attempts with the answer still unfinished. Recorded so
        // the caller can say so instead of presenting a fragment as complete.
        truncated = true;
        break;
      }

      committed = merged();
      segment = "";
      resumes++;
      continuations++;
      cb.onContinue?.(resumes, maxContinuations);
      streamMessages = [
        ...convo,
        { role: "assistant", content: committed },
        { role: "user", content: RESUME_INSTRUCTION },
      ];
    }

    if (errored || roundCalls.length === 0) break;

    if (!offerThisRound) {
      // The model asked for a tool on a round where none were offered. Nothing
      // sane to do but stop; running it would exceed the cap we just enforced.
      hitRoundCap = true;
      break;
    }

    // Echo the model's own request before the results, or providers reject the
    // tool messages as unsolicited.
    convo.push({
      role: "assistant",
      content: content || null,
      tool_calls: roundCalls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.arguments ?? "" },
      })),
    });

    for (const call of roundCalls) {
      const result = await deps.runTool(call.name, call.arguments ?? "", call.id);
      call.result = result.content;
      cb.onToolCalls?.([...toolCalls]);
      if (result.sources?.length) {
        for (const s of result.sources) {
          if (!sources.some((x) => x.url === s.url)) sources.push(s);
        }
        cb.onSources?.([...sources]);
      }
      convo.push({ role: "tool", tool_call_id: call.id, content: result.content });
    }

    rounds++;
    cb.onRoundComplete?.(roundCalls);

    // Text emitted before a tool call is preamble ("let me look that up"). Drop
    // it so the final answer isn't prefixed by narration of its own research.
    content = "";
    cb.onText?.(content);
  }

  return {
    content,
    reasoning,
    toolCalls,
    sources,
    errored,
    rounds,
    hitRoundCap,
    stoppedBy,
    stopReason,
    continuations,
    truncated,
    stalled,
    toolsRejected,
    images,
  };
}
