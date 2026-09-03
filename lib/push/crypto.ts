import {
  createCipheriv,
  createECDH,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// Web Push payload encryption — RFC 8291, `aes128gcm` — implemented directly.
//
// WHY NOT THE `web-push` PACKAGE
//
// Three reasons, in order of weight.
//
//   1. This repository already hand-writes the things at this layer. There is a
//      complete RSS/Atom parser in `lib/news/sync/xml.ts` and a fetch stack in
//      `sync/fetch.ts`, both written rather than installed, both because the
//      dependency would have been larger than the problem and harder to reason
//      about at the boundary where hostile input arrives.
//   2. It is ~120 lines against `node:crypto` primitives that ship with the
//      runtime, and every one of those lines is a specification step with a test
//      below pinning it to the vectors in the RFC.
//   3. A push payload contains headlines the user asked for. It is not sensitive
//      data, but the encryption is not optional — push services reject anything
//      that is not correctly sealed — so the code has to be right, and code you
//      can read is easier to make right than code you can only trust.
//
// The parts, and the order they combine in, are not negotiable: the browser
// implements the other half and will silently drop a message that is a byte out.

/** Every ECDH here is on the NIST P-256 curve, which is all Web Push permits. */
const CURVE = "prime256v1";

/** Record size. One record is always enough — a notification payload is tiny. */
const RECORD_SIZE = 4096;

/**
 * Largest payload the caller may hand us.
 *
 * The push services enforce their own limit (4 KB is the lowest common
 * denominator across Firefox, Chrome and Safari) and the framing below adds 103
 * bytes of header plus a 16-byte tag and a 1-byte delimiter. Failing here with a
 * clear message beats a 413 from a third party.
 */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 17 - 103;

export function base64UrlEncode(input: Buffer | Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Decode base64url, tolerating the padded and non-padded spellings.
 *
 * Browsers hand out unpadded base64url in `PushSubscription.toJSON()`, but
 * subscriptions arrive over the wire from clients we do not control, and some
 * libraries re-encode them with padding or with the standard alphabet.
 */
export function base64UrlDecode(input: string): Buffer {
  const normalised = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalised, "base64");
}

/**
 * HKDF (RFC 5869) with SHA-256, expanding to at most one hash block.
 *
 * Web Push never asks for more than 32 bytes, so the multi-block expansion loop
 * would be dead code — and dead cryptographic code is the kind most likely to be
 * wrong when something finally reaches it.
 */
export function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  if (length > 32) throw new Error("hkdf: single-block expansion only");
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const okm = createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.of(0x01)]))
    .digest();
  return okm.subarray(0, length);
}

export interface SubscriptionKeys {
  /** The user agent's public key: an uncompressed P-256 point, 65 bytes. */
  p256dh: string;
  /** The subscription's shared authentication secret, 16 bytes. */
  auth: string;
}

export interface EncryptedPayload {
  body: Buffer;
  /** Always `aes128gcm`; the older `aesgcm` scheme is deliberately not implemented. */
  contentEncoding: "aes128gcm";
}

export interface EncryptOptions {
  /** Injectable so the RFC's own test vector can be reproduced exactly. */
  salt?: Buffer;
  /** Likewise for the ephemeral key pair. */
  serverPrivateKey?: Buffer;
}

/**
 * Seal a payload for one subscription.
 *
 * The key schedule, verbatim from RFC 8291 §3.4 — the ordering of the two HKDF
 * stages is the part everyone gets wrong, and it is not symmetric:
 *
 *   ecdh_secret = ECDH(server_private, ua_public)
 *   PRK_key     = HMAC(auth_secret, ecdh_secret)
 *   key_info    = "WebPush: info" ‖ 0x00 ‖ ua_public ‖ server_public
 *   IKM         = HMAC(PRK_key, key_info ‖ 0x01)
 *
 *   PRK         = HMAC(salt, IKM)
 *   CEK         = HMAC(PRK, "Content-Encoding: aes128gcm" ‖ 0x00 ‖ 0x01)[0..16]
 *   NONCE       = HMAC(PRK, "Content-Encoding: nonce"     ‖ 0x00 ‖ 0x01)[0..12]
 *
 * Note the asymmetry in `key_info`: the *user agent's* key comes first and the
 * server's second. Swapping them produces a perfectly valid-looking ciphertext
 * that no browser on earth can open.
 */
export function encryptPayload(
  payload: string | Buffer,
  keys: SubscriptionKeys,
  options: EncryptOptions = {},
): EncryptedPayload {
  const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Push payload too large: ${plaintext.length} > ${MAX_PAYLOAD_BYTES} bytes`);
  }

  const uaPublic = base64UrlDecode(keys.p256dh);
  const authSecret = base64UrlDecode(keys.auth);

  // 0x04 is the uncompressed-point marker. A 64-byte key missing it, or a
  // compressed 33-byte point, would be accepted by `computeSecret` on some
  // versions and rejected on others — better to be explicit than to be portable
  // by accident.
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error("Invalid p256dh: expected a 65-byte uncompressed P-256 point");
  }
  if (authSecret.length !== 16) {
    throw new Error("Invalid auth secret: expected 16 bytes");
  }

  const ecdh = createECDH(CURVE);
  if (options.serverPrivateKey) ecdh.setPrivateKey(options.serverPrivateKey);
  else ecdh.generateKeys();

  const serverPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const prkKey = createHmac("sha256", authSecret).update(sharedSecret).digest();
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    uaPublic,
    serverPublic,
  ]);
  const ikm = createHmac("sha256", prkKey)
    .update(Buffer.concat([keyInfo, Buffer.of(0x01)]))
    .digest();

  const salt = options.salt ?? randomBytes(16);
  if (salt.length !== 16) throw new Error("Invalid salt: expected 16 bytes");

  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  // 0x02 is the delimiter for the last (and here, only) record. 0x01 would say
  // "another record follows", and the browser would wait for one that never comes.
  const padded = Buffer.concat([plaintext, Buffer.of(0x02)]);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  // The aes128gcm content-coding header, RFC 8188 §2:
  //   salt(16) ‖ record_size(4, big-endian) ‖ key_id_length(1) ‖ key_id
  // Web Push puts the server's ephemeral public key in the key id field, which
  // is how the browser knows which key to run ECDH against.
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(serverPublic.length, 20);

  return {
    body: Buffer.concat([header, serverPublic, ciphertext]),
    contentEncoding: "aes128gcm",
  };
}

/**
 * Constant-time string comparison for shared secrets.
 *
 * Local to this module rather than imported from the news sync route that has
 * its own copy: a helper that guards a secret should not be one refactor away
 * from being changed by someone who is thinking about something else.
 */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length through the exception path.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
