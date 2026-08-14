/**
 * PKCE for connector OAuth (RFC 7636), plus the state parameter.
 *
 * Atlas is a public client: it has no client secret, because anything shipped to
 * a browser is not secret. PKCE is what makes a public client safe — the
 * authorization code is useless to anyone who intercepts it without the verifier,
 * which never leaves this origin.
 *
 * **S256 only.** RFC 7636 also defines `plain`, where the challenge *is* the
 * verifier; that defeats the entire mechanism against an attacker who can see the
 * authorization request. A server that only supports `plain` is a server Atlas
 * declines to use.
 *
 * Split from the OAuth flow so the crypto is testable in Node — `crypto.subtle`
 * and `crypto.getRandomValues` both exist there.
 */

/** RFC 7636 allows 43–128 characters; 96 random bytes lands comfortably inside. */
const VERIFIER_BYTES = 64;

/**
 * base64url without padding, as every OAuth spec requires.
 *
 * Standard base64 would be rejected: `+` and `/` are not URL-safe and `=` padding
 * is explicitly disallowed in the challenge.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(out);
  return out;
}

/** A fresh, high-entropy code verifier. */
export function createVerifier(): string {
  return base64UrlEncode(randomBytes(VERIFIER_BYTES));
}

/** S256 challenge: base64url(SHA-256(ASCII(verifier))). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Opaque `state`, which solves a different problem from PKCE.
 *
 * PKCE proves the code belongs to this client; `state` proves the *callback*
 * belongs to a flow this client started, defeating CSRF where an attacker feeds
 * the user a callback URL carrying the attacker's own code.
 */
export function createState(): string {
  return base64UrlEncode(randomBytes(32));
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

export async function createPkce(): Promise<PkcePair> {
  const verifier = createVerifier();
  return { verifier, challenge: await challengeFor(verifier), state: createState() };
}

export interface AuthorizeParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  /** The MCP server this token is for. Binds the token to one audience. */
  resource?: string;
  challenge: string;
  state: string;
}

/** Build the authorization URL the user is sent to. */
export function authorizeUrl(p: AuthorizeParams): string {
  const url = new URL(p.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("code_challenge", p.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", p.state);
  if (p.scope) url.searchParams.set("scope", p.scope);
  // RFC 8707. Without it a token minted for one MCP server can be replayed
  // against another that trusts the same authorization server.
  if (p.resource) url.searchParams.set("resource", p.resource);
  return url.toString();
}

export interface CallbackResult {
  code?: string;
  error?: string;
}

/**
 * Read an OAuth callback, checking `state` before anything else.
 *
 * A mismatched or absent state is refused outright: acting on the code first and
 * validating afterwards is the bug that makes state ceremonial.
 */
export function parseCallback(rawUrl: string, expectedState: string): CallbackResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "Callback URL could not be parsed." };
  }
  const params = url.searchParams;
  const state = params.get("state");
  if (!expectedState || state !== expectedState) {
    return { error: "Callback state did not match the request. Authorization was discarded." };
  }
  const err = params.get("error");
  if (err) {
    return { error: params.get("error_description") || err };
  }
  const code = params.get("code");
  if (!code) return { error: "Callback carried no authorization code." };
  return { code };
}

/** Form body for the token exchange. The verifier replaces a client secret. */
export function tokenRequestBody(p: {
  code: string;
  clientId: string;
  redirectUri: string;
  verifier: string;
  resource?: string;
}): string {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: p.code,
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
  });
  if (p.resource) form.set("resource", p.resource);
  return form.toString();
}

/** Form body for a refresh. Same public-client shape: no secret. */
export function refreshRequestBody(p: {
  refreshToken: string;
  clientId: string;
  resource?: string;
}): string {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: p.refreshToken,
    client_id: p.clientId,
  });
  if (p.resource) form.set("resource", p.resource);
  return form.toString();
}
