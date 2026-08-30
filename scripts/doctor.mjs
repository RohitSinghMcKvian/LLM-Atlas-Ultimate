#!/usr/bin/env node
/**
 * `npm run doctor` — is this checkout actually able to run a model?
 *
 * There was no way to answer that. `/api/v1/keys/test` validates a BYOK
 * OpenRouter key only, so an operator key set in `.env.local` could not be
 * checked from anywhere, and the only signal that a provider was really
 * reachable was sending a chat message and reading the failure string.
 *
 * That mattered most in the case this script was written for: `local` is
 * configured by a URL rather than a credential, so a `LOCAL_BASE_URL` pointing
 * at a port with nothing behind it reported as a connected provider everywhere
 * in the UI. Configured and reachable are different questions; this asks both.
 *
 * Reads `.env.local` then `.env` with the same precedence Next.js uses, and
 * applies the same rules as `getProviderRuntime` in `lib/router/index.ts`:
 * `local` needs only `LOCAL_BASE_URL`, every other provider needs its key.
 *
 * Never prints a key — only whether one is present, and its length.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** Minimal dotenv reader. The repo has no dotenv dependency and does not need one. */
function loadEnvFile(name) {
  const path = resolve(ROOT, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Real environment wins, then `.env.local`, then `.env` — Next.js's order.
const fileEnv = { ...loadEnvFile(".env"), ...loadEnvFile(".env.local") };
const env = (name) => process.env[name] || fileEnv[name] || "";

const PROVIDERS = [
  { id: "nvidia", name: "NVIDIA NIM", keyEnv: "NVIDIA_API_KEY", baseEnv: "NVIDIA_BASE_URL", defaultBase: "https://integrate.api.nvidia.com/v1" },
  { id: "openrouter", name: "OpenRouter", keyEnv: "OPENROUTER_API_KEY", baseEnv: "OPENROUTER_BASE_URL", defaultBase: "https://openrouter.ai/api/v1" },
  { id: "google", name: "Google AI Studio", keyEnv: "GOOGLE_API_KEY", baseEnv: "GOOGLE_BASE_URL", defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "groq", name: "Groq", keyEnv: "GROQ_API_KEY", baseEnv: "GROQ_BASE_URL", defaultBase: "https://api.groq.com/openai/v1" },
  // Key optional by design — the URL alone marks it configured.
  { id: "local", name: "Local (Ollama / vLLM)", keyEnv: "LOCAL_API_KEY", baseEnv: "LOCAL_BASE_URL", defaultBase: "", urlIsCredential: true },
];

const c = process.stdout.isTTY
  ? { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", bold: "\x1b[1m", off: "\x1b[0m" }
  : { dim: "", red: "", green: "", yellow: "", bold: "", off: "" };

/** Can we open a connection and get an HTTP reply? Not "is the key valid". */
async function probe(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  const started = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/models`, { signal: ac.signal });
    return { ok: true, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - started,
      reason: ac.signal.aborted ? "timed out after 6s" : (e?.cause?.code ?? e?.message ?? "unreachable"),
    };
  } finally {
    clearTimeout(timer);
  }
}

const configured = [];
const rows = [];

for (const p of PROVIDERS) {
  const key = env(p.keyEnv);
  const base = env(p.baseEnv) || p.defaultBase;
  const isConfigured = p.urlIsCredential ? Boolean(env(p.baseEnv)) : Boolean(key);
  if (!isConfigured) {
    rows.push({ p, state: "unset", base });
    continue;
  }
  configured.push(p.id);
  const result = await probe(base);
  rows.push({ p, state: "configured", base, key, result });
}

console.log(`\n${c.bold}LLM Atlas — provider doctor${c.off}`);
const sources = [".env.local", ".env"].filter((f) => existsSync(resolve(ROOT, f)));
console.log(`${c.dim}env files read: ${sources.length ? sources.join(", ") : "none found"}${c.off}\n`);

for (const { p, state, base, key, result } of rows) {
  const label = p.name.padEnd(22);
  if (state === "unset") {
    const how = p.urlIsCredential ? p.baseEnv : p.keyEnv;
    console.log(`${c.dim}○ ${label} not set        (${how})${c.off}`);
    continue;
  }
  const credential = p.urlIsCredential
    ? `${p.baseEnv} set`
    : `${p.keyEnv} set, ${key.length} chars`;
  if (result.ok) {
    // A 401/403 still proves the address is live — the key is what is wrong.
    const keyLooksBad = result.status === 401 || result.status === 403;
    const mark = keyLooksBad ? `${c.yellow}▲` : `${c.green}●`;
    const verdict = keyLooksBad ? `reachable, KEY REJECTED (HTTP ${result.status})` : `reachable (HTTP ${result.status})`;
    console.log(`${mark} ${label} ${verdict}${c.off}  ${c.dim}${result.ms}ms · ${credential}${c.off}`);
  } else {
    console.log(`${c.red}✗ ${label} UNREACHABLE — ${result.reason}${c.off}  ${c.dim}${credential}${c.off}`);
    console.log(`${c.dim}    ${base}${c.off}`);
  }
}

console.log();
const broken = rows.filter((r) => r.state === "configured" && !r.result.ok);
const rejected = rows.filter((r) => r.state === "configured" && r.result?.ok && (r.result.status === 401 || r.result.status === 403));
// Anything that answered without rejecting us counts as reachable — including a
// 404, since `/models` is optional in the OpenAI-compatible spec and several
// local servers (llama.cpp, some vLLM builds) do not implement it. The host
// replying at all is the fact being established here.
const working = rows.filter(
  (r) =>
    r.state === "configured" &&
    r.result?.ok &&
    r.result.status !== 401 &&
    r.result.status !== 403,
);

if (configured.length === 0) {
  console.log(`${c.yellow}No provider configured.${c.off} The app will run and show a "connect a key" state.`);
  console.log(`Set one in ${c.bold}.env.local${c.off} and restart — GROQ_API_KEY and NVIDIA_API_KEY both have free tiers.`);
  console.log(`${c.dim}Signup links are in .env.example. Never commit the file.${c.off}`);
} else if (broken.length) {
  console.log(`${c.red}${broken.length} configured provider(s) cannot be reached.${c.off}`);
  for (const b of broken) {
    if (b.p.id === "local") {
      console.log(`  ${c.bold}local${c.off} is configured by ${c.bold}LOCAL_BASE_URL${c.off} alone — no key needed — so it counts as`);
      console.log(`  connected even when nothing is serving that port. Start Ollama, or comment the`);
      console.log(`  line out of .env.local. Left as-is it will be offered as a working provider.`);
    } else {
      console.log(`  ${b.p.name}: check ${b.p.baseEnv} or your network.`);
    }
  }
  process.exitCode = 1;
} else if (rejected.length && !working.length) {
  console.log(`${c.yellow}Every configured provider answered, but rejected the key.${c.off} Re-issue it.`);
  process.exitCode = 1;
} else {
  console.log(`${c.green}Ready.${c.off} ${working.length} provider(s) reachable: ${working.map((w) => w.p.id).join(", ")}`);
  console.log(`${c.dim}Reachability only — a valid key is confirmed by the first real request.${c.off}`);
}
console.log();
