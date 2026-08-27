import { describe, expect, it } from "vitest";
import {
  ALLOWED_AUDIO_TYPES,
  DEFAULT_STT,
  MAX_AUDIO_BYTES,
  isAllowedAudioType,
  listSttProviders,
  sttProviderById,
} from "./providers";

describe("provider registry", () => {
  it("defaults to the one that needs no key", () => {
    expect(DEFAULT_STT).toBe("browser");
    expect(sttProviderById(undefined).needsKey).toBe(false);
    expect(sttProviderById("nonsense").id).toBe("browser");
  });

  it("every provider states where the audio goes", () => {
    for (const p of listSttProviders()) {
      expect(p.privacy.length).toBeGreaterThan(20);
    }
  });

  it("says plainly that the keyless path is not on-device", () => {
    // A privacy claim that is wrong is worse than making none.
    expect(sttProviderById("browser").privacy).toContain("Google");
  });

  it("the browser backend has no request to build", () => {
    const p = sttProviderById("browser");
    expect(p.clientSide).toBe(true);
    expect(p.request).toBeUndefined();
  });
});

describe("request building", () => {
  const groq = sttProviderById("groq");

  it("targets the OpenAI-compatible transcription path", () => {
    const spec = groq.request!({ baseUrl: "https://api.example.com/openai/v1", key: "k" });
    expect(spec.url).toBe("https://api.example.com/openai/v1/audio/transcriptions");
    expect(spec.headers.Authorization).toBe("Bearer k");
  });

  it("does not double a trailing slash", () => {
    expect(groq.request!({ baseUrl: "https://x.dev/v1/" }).url).toBe(
      "https://x.dev/v1/audio/transcriptions",
    );
  });

  it("carries the vocabulary hint, so a mishearing is prevented not repaired", () => {
    const spec = groq.request!({ baseUrl: "https://x.dev/v1", prompt: "MMLU, Qwen3" });
    expect(spec.form.prompt).toContain("MMLU");
  });

  it("sends no Authorization header when there is no key", () => {
    expect(sttProviderById("local").request!({ baseUrl: "http://localhost:8080/v1" }).headers).toEqual({});
  });

  it("falls back to the backend's own default model", () => {
    expect(groq.request!({ baseUrl: "https://x.dev/v1" }).form.model).toBe(groq.defaultModel);
    expect(groq.request!({ baseUrl: "https://x.dev/v1", model: "custom" }).form.model).toBe("custom");
  });
});

describe("response parsing", () => {
  const groq = sttProviderById("groq");

  it("reads the transcript", () => {
    expect(groq.parse!({ text: "  hello there  " })).toBe("hello there");
    expect(groq.parse!("plain text")).toBe("plain text");
  });

  it("returns nothing for a malformed body rather than throwing", () => {
    // One bad response costs an utterance, not the session.
    for (const bad of [null, undefined, {}, { text: 42 }, []]) {
      expect(groq.parse!(bad)).toBe("");
    }
  });
});

describe("audio guards", () => {
  it("accepts the containers a browser records", () => {
    expect(isAllowedAudioType("audio/webm;codecs=opus")).toBe(true);
    expect(isAllowedAudioType("AUDIO/WAV")).toBe(true);
    for (const t of ALLOWED_AUDIO_TYPES) expect(isAllowedAudioType(t)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const t of ["text/html", "application/json", "", undefined]) {
      expect(isAllowedAudioType(t)).toBe(false);
    }
  });

  it("caps an utterance well above a minute of speech", () => {
    expect(MAX_AUDIO_BYTES).toBeGreaterThan(1_000_000);
  });
});
