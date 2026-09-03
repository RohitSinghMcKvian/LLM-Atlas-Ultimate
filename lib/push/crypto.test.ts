import { createPublicKey, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  hkdf,
  MAX_PAYLOAD_BYTES,
  secretEquals,
} from "./crypto";
import { audienceOf, generateVapidKeys, readVapidKeys, vapidHeaders } from "./vapid";

// The only honest way to test a cipher is against the specification's own
// vector. Web Push encryption fails silently — a browser handed a byte-wrong
// message drops it without a console entry, without an error event, and without
// telling the server anything other than 201 Created. A unit test that merely
// round-trips our own encrypt against our own decrypt would pass forever while
// no notification was ever delivered to anyone.

describe("encryptPayload — RFC 8291 §5 test vector", () => {
  // Verbatim from the RFC. Every value below is fixed by the specification, and
  // reproducing the exact ciphertext proves the key schedule, the info strings,
  // the record framing and the padding delimiter are all correct together.
  const plaintext = "When I grow up, I want to be a watermelon";

  const uaPublic =
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
  const authSecret = "BTBZMqHH6r4Tts7J_aSIgg";
  const asPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
  const salt = "DGv6ra1nlYgDCS1FRnbzlw";

  const expected =
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

  it("reproduces the specification's ciphertext exactly", () => {
    const { body } = encryptPayload(
      plaintext,
      { p256dh: uaPublic, auth: authSecret },
      {
        salt: base64UrlDecode(salt),
        serverPrivateKey: base64UrlDecode(asPrivate),
      },
    );

    expect(base64UrlEncode(body)).toBe(expected);
  });

  it("frames the aes128gcm content-coding header correctly", () => {
    const { body } = encryptPayload(
      plaintext,
      { p256dh: uaPublic, auth: authSecret },
      { salt: base64UrlDecode(salt), serverPrivateKey: base64UrlDecode(asPrivate) },
    );

    expect(body.subarray(0, 16)).toEqual(base64UrlDecode(salt));
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    // The key id field carries the server's ephemeral public key. Without it the
    // browser has nothing to run ECDH against.
    expect(body.readUInt8(21)).toBe(0x04);
  });

  it("declares aes128gcm, never the retired aesgcm scheme", () => {
    const result = encryptPayload("hello", { p256dh: uaPublic, auth: authSecret });
    expect(result.contentEncoding).toBe("aes128gcm");
  });

  it("produces a different ciphertext each time when the salt is not pinned", () => {
    // The salt and the ephemeral key are both random per message. Identical
    // output across two calls would mean one of them is not.
    const a = encryptPayload(plaintext, { p256dh: uaPublic, auth: authSecret });
    const b = encryptPayload(plaintext, { p256dh: uaPublic, auth: authSecret });
    expect(a.body.equals(b.body)).toBe(false);
  });

  describe("input validation", () => {
    it("rejects a public key that is not an uncompressed point", () => {
      expect(() =>
        encryptPayload("x", { p256dh: base64UrlEncode(Buffer.alloc(64)), auth: authSecret }),
      ).toThrow(/uncompressed/i);
    });

    it("rejects an auth secret of the wrong length", () => {
      expect(() =>
        encryptPayload("x", { p256dh: uaPublic, auth: base64UrlEncode(Buffer.alloc(8)) }),
      ).toThrow(/auth secret/i);
    });

    it("rejects a payload too large to fit one record", () => {
      expect(() =>
        encryptPayload("x".repeat(MAX_PAYLOAD_BYTES + 1), {
          p256dh: uaPublic,
          auth: authSecret,
        }),
      ).toThrow(/too large/i);
    });

    it("accepts a payload exactly at the limit", () => {
      expect(() =>
        encryptPayload("x".repeat(MAX_PAYLOAD_BYTES), { p256dh: uaPublic, auth: authSecret }),
      ).not.toThrow();
    });
  });
});

describe("base64url", () => {
  it("round-trips", () => {
    const bytes = Buffer.from([0xfb, 0xff, 0x00, 0x3e, 0x3f]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it("emits no padding and no +/ characters", () => {
    const encoded = base64UrlEncode(Buffer.from([0xfb, 0xff, 0xfe]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("decodes the padded and standard-alphabet spellings too", () => {
    // Subscriptions arrive from clients we do not control, and some libraries
    // re-encode them.
    expect(base64UrlDecode("-_8=")).toEqual(base64UrlDecode("-_8"));
    expect(base64UrlDecode("+/8=")).toEqual(base64UrlDecode("-_8"));
  });
});

describe("hkdf", () => {
  it("refuses to expand past one hash block", () => {
    // Web Push never needs more, and an untested expansion loop is worse than a
    // missing one.
    expect(() => hkdf(Buffer.alloc(16), Buffer.alloc(32), Buffer.from("x"), 33)).toThrow();
  });

  it("is deterministic and length-respecting", () => {
    const args = [Buffer.alloc(16, 1), Buffer.alloc(32, 2), Buffer.from("info")] as const;
    expect(hkdf(...args, 16)).toEqual(hkdf(...args, 16));
    expect(hkdf(...args, 12)).toHaveLength(12);
    // A shorter expansion is a prefix of a longer one.
    expect(hkdf(...args, 12)).toEqual(hkdf(...args, 16).subarray(0, 12));
  });
});

describe("secretEquals", () => {
  it("compares equal secrets as equal", () => {
    expect(secretEquals("a-long-shared-secret", "a-long-shared-secret")).toBe(true);
  });

  it("rejects differing secrets, including differing lengths", () => {
    expect(secretEquals("secret", "secrex")).toBe(false);
    // The length mismatch must not throw the way `timingSafeEqual` would.
    expect(() => secretEquals("short", "much longer secret")).not.toThrow();
    expect(secretEquals("short", "much longer secret")).toBe(false);
  });
});

// --- VAPID ------------------------------------------------------------------

describe("vapidHeaders", () => {
  const keys = generateVapidKeys("mailto:ops@example.test");
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc123?x=1";
  const NOW = Date.parse("2026-01-15T00:00:00.000Z");

  function parts() {
    const { Authorization } = vapidHeaders(endpoint, keys, NOW);
    const token = /t=([^,]+)/.exec(Authorization)?.[1] ?? "";
    const [header, payload, signature] = token.split(".");
    return {
      Authorization,
      token,
      header: JSON.parse(base64UrlDecode(header).toString()),
      payload: JSON.parse(base64UrlDecode(payload).toString()),
      signature: base64UrlDecode(signature),
      signingInput: `${header}.${payload}`,
    };
  }

  it("uses the vapid scheme with both t and k parameters", () => {
    const { Authorization } = parts();
    expect(Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(Authorization).toContain(`k=${keys.publicKey}`);
  });

  it("declares ES256", () => {
    expect(parts().header).toEqual({ typ: "JWT", alg: "ES256" });
  });

  it("scopes the audience to scheme and host, never the path", () => {
    // The endpoint path is the subscription's bearer secret, and FCM rejects a
    // token whose `aud` carries it.
    expect(parts().payload.aud).toBe("https://fcm.googleapis.com");
    expect(parts().payload.aud).not.toContain("abc123");
  });

  it("expires within the 24 hours the specification allows", () => {
    const { exp } = parts().payload;
    const seconds = exp - Math.floor(NOW / 1000);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(24 * 3_600);
  });

  it("carries the contact subject", () => {
    expect(parts().payload.sub).toBe("mailto:ops@example.test");
  });

  it("signs with a raw 64-byte r‖s, not DER", () => {
    // The single most common way a VAPID implementation fails: OpenSSL's default
    // ES256 output is a DER SEQUENCE, JOSE requires the concatenated form, and
    // every push service answers 401 without saying why.
    const { signature } = parts();
    expect(signature).toHaveLength(64);
    expect(signature[0]).not.toBe(0x30); // a DER SEQUENCE would start here
  });

  it("produces a signature the public key actually verifies", () => {
    const { signature, signingInput } = parts();
    const point = base64UrlDecode(keys.publicKey);
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: base64UrlEncode(point.subarray(1, 33)),
        y: base64UrlEncode(point.subarray(33, 65)),
      },
    });

    const verified = createVerify("SHA256")
      .update(signingInput)
      .verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, signature);

    expect(verified).toBe(true);
  });
});

describe("generateVapidKeys", () => {
  it("emits a 65-byte uncompressed public point and a 32-byte scalar", () => {
    const keys = generateVapidKeys();
    const pub = base64UrlDecode(keys.publicKey);
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(0x04);
    expect(base64UrlDecode(keys.privateKey)).toHaveLength(32);
  });

  it("generates a different pair each call", () => {
    expect(generateVapidKeys().publicKey).not.toBe(generateVapidKeys().publicKey);
  });
});

describe("readVapidKeys", () => {
  const valid = generateVapidKeys();

  it("returns null when nothing is configured", () => {
    // The posture of the whole feature: no keys is a working deployment that
    // does not offer notifications, never a crash.
    expect(readVapidKeys({})).toBeNull();
  });

  it("returns null when only one half is present", () => {
    expect(
      readVapidKeys({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: valid.publicKey }),
    ).toBeNull();
    expect(readVapidKeys({ VAPID_PRIVATE_KEY: valid.privateKey })).toBeNull();
  });

  it("returns null for a truncated key rather than failing later at the push service", () => {
    expect(
      readVapidKeys({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: valid.publicKey.slice(0, 20),
        VAPID_PRIVATE_KEY: valid.privateKey,
      }),
    ).toBeNull();
  });

  it("reads a well-formed pair and defaults the subject", () => {
    const keys = readVapidKeys({
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: valid.publicKey,
      VAPID_PRIVATE_KEY: valid.privateKey,
    });

    expect(keys?.publicKey).toBe(valid.publicKey);
    expect(keys?.subject).toMatch(/^mailto:/);
  });
});

describe("audienceOf", () => {
  it.each([
    ["https://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com"],
    ["https://updates.push.services.mozilla.com/wpush/v2/abc", "https://updates.push.services.mozilla.com"],
    ["https://web.push.apple.com/QA/very/long/path", "https://web.push.apple.com"],
  ])("reduces %s to its origin", (endpoint, expected) => {
    expect(audienceOf(endpoint)).toBe(expected);
  });

  it("keeps a non-default port, which is part of the origin", () => {
    expect(audienceOf("https://push.test:8443/x")).toBe("https://push.test:8443");
  });
});
