import { NextRequest } from "next/server";
import {
  MAX_AUDIO_BYTES,
  isAllowedAudioType,
  sttProviderById,
} from "@/lib/voice/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transcribe one utterance, on the backend the user chose.
 *
 * A thin, stateless forwarder, following the same BYOK contract as
 * `/api/v1/search` and `/api/v1/embeddings`: the key arrives per request in a
 * header, is forwarded once, and is never stored, logged or echoed. The audio is
 * never written anywhere - it is read from the request, sent on, and dropped.
 *
 * The keyless path does not come here at all. `SpeechRecognition` runs in the
 * browser and never touches Atlas, which is why it stays the default and the
 * only zero-configuration option.
 *
 * How each backend's request is built and how its response is read live in
 * `lib/voice/providers.ts`, so this route stays a fetch plus error handling and
 * the provider quirks are unit-tested without a network.
 */

const TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ text: "", error: "Expected multipart form data." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return Response.json({ text: "", error: "No audio was sent." }, { status: 400 });
  }
  // Both checks before anything is forwarded: a size cap that runs after the
  // upstream call has already paid for the upload.
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ text: "", error: "That recording is too long." }, { status: 413 });
  }
  if (!isAllowedAudioType(audio.type)) {
    return Response.json({ text: "", error: "Unsupported audio format." }, { status: 415 });
  }

  const provider = sttProviderById(String(form.get("provider") ?? ""));
  if (provider.clientSide || !provider.request || !provider.parse) {
    return Response.json(
      { text: "", error: `${provider.label} transcription runs in the browser, not here.` },
      { status: 400 },
    );
  }

  const key = req.headers.get("x-voice-key")?.trim() || undefined;
  if (provider.needsKey && !key) {
    return Response.json({
      text: "",
      error: `${provider.label} needs an API key. Add one in settings, or use the browser instead.`,
    });
  }

  const baseUrl = String(form.get("base_url") ?? "").trim();
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    return Response.json({ text: "", error: "No transcription endpoint is configured." });
  }

  const spec = provider.request({
    baseUrl,
    key,
    model: String(form.get("model") ?? "") || undefined,
    language: String(form.get("language") ?? "") || undefined,
    prompt: String(form.get("prompt") ?? "") || undefined,
  });

  const upstream = new FormData();
  upstream.set("file", audio, "utterance.webm");
  upstream.set("model", spec.form.model);
  upstream.set("response_format", spec.form.responseFormat);
  if (spec.form.language) upstream.set("language", spec.form.language);
  if (spec.form.prompt && provider.acceptsPrompt) upstream.set("prompt", spec.form.prompt);

  try {
    const res = await fetch(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: upstream,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      // A redirect is a second URL that never passed any check here, the same
      // reasoning the MCP proxy gives for refusing them.
      redirect: "manual",
    });
    if (!res.ok) {
      // The status, not the body: an upstream error body can echo the request
      // and sometimes the key, and neither belongs in a response Atlas relays.
      return Response.json({ text: "", error: `${provider.label} returned HTTP ${res.status}.` });
    }
    const raw = await res.json().catch(() => null);
    return Response.json({ text: provider.parse(raw), provider: provider.id });
  } catch {
    return Response.json({ text: "", error: `${provider.label} did not respond.` });
  }
}
