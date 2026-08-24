/**
 * Speech-to-text backends, behind one interface.
 *
 * Modelled on `lib/research/providers.ts`, which solved the same problem for
 * web search: a keyless default that is the only zero-configuration path, plus
 * optional keyed backends that are better when someone has a key. The shape is
 * copied deliberately - it means a reader who knows one knows the other, and it
 * means the request building and response parsing are unit-tested here rather
 * than inside a route.
 *
 * The default is the browser's own `SpeechRecognition`, which needs no key and
 * no server. It is not described here at all: it never leaves the client, so it
 * has no request to build. This module covers only the backends that do.
 *
 * ### Two things stated plainly rather than implied
 *
 * 1. **Keyless is not on-device.** Chrome's `SpeechRecognition` sends audio to
 *    Google's servers. The UI must say so; pretending otherwise is the kind of
 *    privacy claim that is worse than making none.
 * 2. **These endpoints are unverified here.** They are the OpenAI-compatible
 *    `/audio/transcriptions` shape, which the providers Atlas already configures
 *    speak, but no live call has been made from this build. `SELF-AUDIT` records
 *    that; a backend must be exercised before its flag is turned on.
 */

export type SttProviderId = "browser" | "groq" | "openai_compatible" | "local";

export interface SttRequestSpec {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  /** Multipart body. Built by the caller, which owns the audio blob. */
  form: { model: string; language?: string; prompt?: string; responseFormat: string };
}

export interface SttProvider {
  id: SttProviderId;
  label: string;
  /** What the UI says about where the audio goes. Never omitted. */
  privacy: string;
  needsKey: boolean;
  /** Runs entirely in the browser, so there is no request to build. */
  clientSide: boolean;
  /** Default model id for this backend. */
  defaultModel: string;
  /** Whether the backend accepts a vocabulary hint. */
  acceptsPrompt: boolean;
  request?: (opts: SttRequestOptions) => SttRequestSpec;
  parse?: (raw: unknown) => string;
}

export interface SttRequestOptions {
  baseUrl: string;
  model?: string;
  key?: string;
  language?: string;
  /** Vocabulary hint from `biasPrompt`, when the backend takes one. */
  prompt?: string;
}

function openAiCompatible(
  id: SttProviderId,
  label: string,
  privacy: string,
  defaultModel: string,
  needsKey: boolean,
): SttProvider {
  return {
    id,
    label,
    privacy,
    needsKey,
    clientSide: false,
    defaultModel,
    acceptsPrompt: true,
    request: (o) => ({
      url: `${o.baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
      method: "POST",
      headers: (o.key ? { Authorization: `Bearer ${o.key}` } : {}) as Record<string, string>,
      form: {
        model: o.model || defaultModel,
        language: o.language,
        // The vocabulary hint. Fixing a mishearing before it happens beats
        // fixing it afterwards, and `lib/voice/lexicon.ts` still runs either
        // way - the two are complementary, and only one of them works on a
        // backend with no such field.
        prompt: o.prompt,
        responseFormat: "json",
      },
    }),
    parse: (raw) => {
      if (typeof raw === "string") return raw.trim();
      if (raw && typeof raw === "object" && "text" in raw) {
        const text = (raw as { text?: unknown }).text;
        return typeof text === "string" ? text.trim() : "";
      }
      // A malformed body returns nothing rather than throwing, so one bad
      // response costs an utterance and not the session.
      return "";
    },
  };
}

export const STT_PROVIDERS: Record<SttProviderId, SttProvider> = {
  browser: {
    id: "browser",
    label: "Browser",
    privacy:
      "Your browser handles this. In Chrome and Edge that means the audio is sent to Google's speech service.",
    needsKey: false,
    clientSide: true,
    defaultModel: "",
    acceptsPrompt: false,
  },
  groq: openAiCompatible(
    "groq",
    "Groq",
    "Audio is sent to Groq with your key. Atlas stores and logs nothing.",
    "whisper-large-v3-turbo",
    true,
  ),
  openai_compatible: openAiCompatible(
    "openai_compatible",
    "OpenAI-compatible",
    "Audio is sent to the endpoint you configured, with your key. Atlas stores and logs nothing.",
    "whisper-1",
    true,
  ),
  local: openAiCompatible(
    "local",
    "Local server",
    "Audio stays on your own machine.",
    "whisper-1",
    false,
  ),
};

export const DEFAULT_STT: SttProviderId = "browser";

export function sttProviderById(id: string | undefined): SttProvider {
  return STT_PROVIDERS[(id ?? "") as SttProviderId] ?? STT_PROVIDERS[DEFAULT_STT];
}

export function listSttProviders(): SttProvider[] {
  return Object.values(STT_PROVIDERS);
}

/** Largest utterance accepted, in bytes. A minute of Opus is well under this. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** Audio container types the route will forward. */
export const ALLOWED_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/mp4",
  "audio/mpeg",
  "audio/x-m4a",
];

export function isAllowedAudioType(mime: string | undefined): boolean {
  if (!mime) return false;
  const base = mime.split(";")[0].trim().toLowerCase();
  return ALLOWED_AUDIO_TYPES.includes(base);
}
