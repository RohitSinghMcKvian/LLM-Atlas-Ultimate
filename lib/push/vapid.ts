import { createPrivateKey, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { base64UrlDecode, base64UrlEncode } from "./crypto";

// VAPID — RFC 8292. How a push service knows the message came from this server.
//
// The push endpoint a browser hands out is a bearer URL: anyone holding it can
// post to it. VAPID is what stops that from being the whole story. Every request
// carries a short-lived JWT signed with a P-256 key whose public half the browser
// was given at subscribe time, so the push service can bind the subscription to
// one application server and reject anybody else.
//
// Practically, it is also non-optional: Chrome's FCM endpoint returns 401 for an
// unsigned request, and Firefox's autopush returns 401 for a signature it cannot
// verify against the `k` parameter.

/** Twelve hours. The specification caps it at 24; half that leaves room for clock skew. */
const TOKEN_TTL_SECONDS = 12 * 3_600;

export interface VapidKeys {
  /** Uncompressed P-256 public point, 65 bytes, base64url. This is what the browser subscribes with. */
  publicKey: string;
  /** The 32-byte private scalar, base64url. Server-side only, ever. */
  privateKey: string;
  /**
   * Contact for the push service operator, `mailto:` or `https:`.
   *
   * Required by the specification and genuinely used: when a deployment starts
   * behaving badly, this is the address that hears about it before the endpoint
   * is blocked.
   */
  subject: string;
}

/**
 * Generate a fresh application-server key pair.
 *
 * Used by `scripts/generate-vapid-keys.mjs` and by the tests. Never called at
 * runtime — a key regenerated on a cold start would invalidate every
 * subscription in the database, silently, because a subscription is bound to the
 * public key it was created with.
 */
export function generateVapidKeys(subject = "mailto:hello@llmatlas.xyz"): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

  const pub = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const priv = privateKey.export({ format: "jwk" }) as { d: string };

  return {
    // The wire format is the uncompressed point, not the JWK coordinates: 0x04
    // followed by X then Y.
    publicKey: base64UrlEncode(
      Buffer.concat([Buffer.of(0x04), base64UrlDecode(pub.x), base64UrlDecode(pub.y)]),
    ),
    privateKey: priv.d,
    subject,
  };
}

/**
 * Read the configured keys, or nothing.
 *
 * Returning `null` rather than throwing is the whole posture of this feature: a
 * deployment with no VAPID keys is a perfectly good deployment that does not
 * offer notifications, exactly as a deployment with no operator key is a
 * perfectly good one that does not offer LLM abstracts. Nothing 500s, and the
 * UI simply never shows the control.
 */
// `Record` rather than `NodeJS.ProcessEnv`, matching `lib/news/snapshot.ts`: the
// latter requires `NODE_ENV`, which makes it impossible to pass a two-key object
// from a test without an `as unknown` cast that defeats the point of the type.
export function readVapidKeys(
  env: Record<string, string | undefined> = process.env,
): VapidKeys | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;

  // A truncated key is a configuration error that would otherwise surface as an
  // opaque 401 from a third party, hours later, on a cron run nobody is watching.
  if (base64UrlDecode(publicKey).length !== 65) return null;
  if (base64UrlDecode(privateKey).length !== 32) return null;

  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT?.trim() || "mailto:hello@llmatlas.xyz",
  };
}

export function isPushConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readVapidKeys(env) !== null;
}

/**
 * Rebuild a signing key from the raw scalar.
 *
 * `node:crypto` cannot import a bare 32-byte scalar, so the private JWK is
 * reconstructed around it — which needs X and Y from the public point. That is
 * why both halves are required to sign, not just the private one.
 */
function signingKey(keys: VapidKeys): KeyObject {
  const point = base64UrlDecode(keys.publicKey);
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(point.subarray(1, 33)),
      y: base64UrlEncode(point.subarray(33, 65)),
      d: keys.privateKey,
    },
  });
}

/**
 * The audience claim: scheme and host of the push endpoint, and nothing else.
 *
 * A JWT whose `aud` carries the path is rejected by FCM. The endpoint path is
 * the subscription's bearer secret, so leaving it out of a token that transits
 * intermediaries is also the right thing to do independently of the rule.
 */
export function audienceOf(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}`;
}

export interface VapidHeaders {
  Authorization: string;
}

/**
 * Sign one request's VAPID token.
 *
 * ES256 signatures come in two spellings and only one is legal here: the JOSE
 * form is the raw 64-byte `r ‖ s`, while OpenSSL's default is a DER SEQUENCE.
 * `dsaEncoding: "ieee-p1363"` selects the former. Without it every push service
 * returns 401 and the reason is nowhere in the response.
 */
export function vapidHeaders(
  endpoint: string,
  keys: VapidKeys,
  now = Date.now(),
): VapidHeaders {
  const header = base64UrlEncode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64UrlEncode(
    Buffer.from(
      JSON.stringify({
        aud: audienceOf(endpoint),
        exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
        sub: keys.subject,
      }),
    ),
  );

  const signingInput = `${header}.${payload}`;
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key: signingKey(keys), dsaEncoding: "ieee-p1363" });

  return {
    Authorization: `vapid t=${signingInput}.${base64UrlEncode(signature)}, k=${keys.publicKey}`,
  };
}
