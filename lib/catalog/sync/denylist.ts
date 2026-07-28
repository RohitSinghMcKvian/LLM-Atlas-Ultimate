// Endpoints that are not chat models, and must never reach the catalog.
//
// Shared by both provider adapters. It used to live in `nvidia.ts` with
// `openrouter.ts` importing `isChatCapable` from it — shared already, just
// housed as if it were NVIDIA-specific, which is how `google/lyria-3-pro-preview`
// (a *music generation* model) ended up in the model picker.
//
// Each pattern is paired with a representative id. The pairing is the point: a
// typo'd or over-narrowed pattern is silently harmless until the day it lets an
// embedding model into the picker, where it 400s on `/chat/completions`. The test
// asserts every pattern still excludes its own example — and, just as important,
// that a list of real chat models is *not* excluded, so an over-broad pattern
// cannot quietly eat the catalog.

export interface DenyRule {
  pattern: RegExp;
  example: string;
}

/**
 * Endpoints that speak a different protocol than chat: embeddings, rerankers,
 * classifiers, speech, OCR, and media generation.
 *
 * Some entries are defensive — NVIDIA does not currently serve a speech model
 * through this endpoint, but the list is the only thing standing between the
 * catalog and one appearing.
 */
export const NON_CHAT_RULES: DenyRule[] = [
  { pattern: /embed/i, example: "nvidia/nv-embedqa-e5-v5" },
  { pattern: /(^|[-/])bge-/i, example: "baai/bge-m3" },
  { pattern: /rerank/i, example: "nvidia/nv-rerankqa-mistral-4b-v3" },
  { pattern: /nemoretriever/i, example: "nvidia/nemoretriever-parse" },
  { pattern: /guard/i, example: "meta/llama-guard-4-12b" },
  // `topic-control` needs no rule of its own: every such endpoint NVIDIA ships is
  // a `nemoguard` variant, already covered above.
  { pattern: /content-safety/i, example: "nvidia/nemotron-3.5-content-safety" },
  { pattern: /nvclip/i, example: "nvidia/nvclip" },
  { pattern: /(^|[-/])riva-/i, example: "nvidia/riva-translate-4b-instruct" },
  { pattern: /parakeet|canary/i, example: "nvidia/parakeet-ctc-1.1b" },
  { pattern: /(^|[-/])(asr|ocr|tts|stt)(-|$)/i, example: "vendor/some-ocr-model" },
  { pattern: /moderation/i, example: "vendor/text-moderation-latest" },
  // Media generation. Lyria is Google's music model and was live in the catalog:
  // it accepts `/chat/completions` and then hangs, so it read as a broken chat
  // model rather than as the wrong kind of model.
  { pattern: /(^|[-/])lyria(-|$)/i, example: "google/lyria-3-pro-preview" },
  {
    pattern: /(^|[-/])(imagen|veo|sora|dall-e|whisper|flux|stable-diffusion)(-|$|\d)/i,
    example: "google/imagen-4",
  },
  // Classifiers and detectors. These reached the Free tab once the widened probe
  // started publishing NIM-only models: NVIDIA serves them on the same endpoint,
  // and a one-token probe *succeeds*, so liveness cannot tell them apart from a
  // chat model. Only the id can.
  { pattern: /detector/i, example: "nvidia/ai-synthetic-video-detector" },
  { pattern: /(^|[-/])gliner(-|$)/i, example: "nvidia/gliner-pii" },
  { pattern: /(^|[-/])ising-calibration/i, example: "nvidia/ising-calibration-1-35b-a3b" },
];

/**
 * OpenRouter's meta-routers (`openrouter/auto`, `openrouter/free`, …).
 *
 * Excluded deliberately, not incidentally. They are not models:
 *
 *   1. **No stable identity.** The weights serving a request change per request,
 *      so `contextWindow`, `pricing`, `benchmarks` and `intelligenceIndex` are
 *      fabrications wherever they are rendered — the leaderboard, the cost
 *      frontier, compare.
 *   2. **Unclassifiable cost.** `openrouter/auto` bills at the *selected* model's
 *      rate, so `routeCost` in `lib/catalog/availability.ts` cannot honestly call
 *      it free or metered. That breaks the invariant the whole availability
 *      design rests on.
 *   3. `openrouter/free` is a worse version of Atlas's own Free tab, which at
 *      least probes its members for liveness.
 *
 * The capability is worth having — as an Atlas *router policy* alongside
 * `lib/chat/escalate.ts`, not as a catalog row.
 */
export const META_ROUTER_RULES: DenyRule[] = [
  { pattern: /^openrouter\//i, example: "openrouter/auto" },
];

export const ALL_DENY_RULES: DenyRule[] = [...NON_CHAT_RULES, ...META_ROUTER_RULES];

export const NON_CHAT_PATTERNS: RegExp[] = NON_CHAT_RULES.map((r) => r.pattern);

/** Whether an upstream provider id is a chat model Atlas should publish. */
export function isChatCapable(id: string): boolean {
  return !ALL_DENY_RULES.some((r) => r.pattern.test(id));
}

/**
 * Whether an already-published Atlas id must be withdrawn.
 *
 * Needed because `mergeSnapshot` carries the previous record's models forward,
 * which would otherwise let a model that predates a denylist entry survive
 * forever. Atlas ids have the namespace stripped (`openrouter/auto` → `auto`), so
 * the meta-router pattern cannot match them — they are matched by name instead.
 */
const RETIRED_ATLAS_IDS = new Set([
  "auto",
  "auto-beta",
  "free",
  "fusion",
  "bodybuilder",
  "pareto-code",
]);

export function isDeniedAtlasId(id: string, routes: readonly { model: string }[] = []): boolean {
  if (RETIRED_ATLAS_IDS.has(id)) return true;
  if (NON_CHAT_PATTERNS.some((re) => re.test(id))) return true;
  // A carried-forward entry still records its upstream ids, which is the most
  // reliable thing to match on.
  return routes.some((r) => ALL_DENY_RULES.some((rule) => rule.pattern.test(r.model)));
}
