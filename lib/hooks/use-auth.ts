"use client";

import * as React from "react";
import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";
import { invalidateRepos, friendlyAuthError, signOutEverywhere } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/routes";
import type { Profile, UserRole } from "@/lib/supabase/types";

export interface AuthState {
  /** Whether Supabase is set up at all. When false, Atlas is local-only. */
  configured: boolean;
  /** Null when signed out; undefined until the first check resolves. */
  email: string | null | undefined;
  userId: string | null;
  loading: boolean;
  /** Display identity from migration 0011. Null until it loads, or if 0011 hasn't run. */
  profile: Profile | null;
  /** Convenience read of `profile.role`; `null` while unknown. */
  role: UserRole | null;
  isAdmin: boolean;
}

/**
 * Profile cache, keyed by user id.
 *
 * `useAuth` is mounted in the topbar on every workspace route and again inside
 * any dialog that needs identity. Without this, each mount would issue its own
 * `profiles` select for a row that changes about never.
 */
const profileCache = new Map<string, Profile | null>();
const profileInflight = new Map<string, Promise<Profile | null>>();

function clearProfileCache() {
  profileCache.clear();
  profileInflight.clear();
}

async function loadProfile(userId: string): Promise<Profile | null> {
  if (profileCache.has(userId)) return profileCache.get(userId) ?? null;
  const existing = profileInflight.get(userId);
  if (existing) return existing;

  const request = (async () => {
    const c = await getSupabaseBrowser();
    if (!c) return null;
    const { data, error } = await c
      .from("profiles")
      .select("id, email, display_name, avatar_url, role, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle();
    // Missing table means migration 0011 hasn't been applied. That is a valid
    // state — the account menu just falls back to the email address.
    const profile = error ? null : ((data as Profile) ?? null);
    profileCache.set(userId, profile);
    return profile;
  })().finally(() => {
    profileInflight.delete(userId);
  });

  profileInflight.set(userId, request);
  return request;
}

/**
 * Session state for the sign-in UI.
 *
 * Signing in or out changes which persistence driver is correct, so both
 * transitions invalidate the cached repos. Auth is now a gate on the surfaces
 * that persist per-user rows (see `lib/auth/routes.ts`), but the reference
 * surfaces and the whole local-first fallback still work signed out.
 */
export function useAuth(): AuthState {
  const configured = isSupabaseConfigured();
  const [email, setEmail] = React.useState<string | null | undefined>(
    configured ? undefined : null,
  );
  const [userId, setUserId] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<Profile | null>(null);

  React.useEffect(() => {
    if (!configured) return;
    let alive = true;
    let unsub: (() => void) | undefined;

    /** Apply a user id + email pair, then fill in the profile behind it. */
    const apply = (id: string | null, mail: string | null) => {
      if (!alive) return;
      setEmail(mail);
      setUserId(id);
      if (!id) {
        setProfile(null);
        return;
      }
      void loadProfile(id).then((p) => {
        if (alive) setProfile(p);
      });
    };

    void (async () => {
      const c = await getSupabaseBrowser();
      if (!c || !alive) return;
      const { data } = await c.auth.getUser();
      if (!alive) return;
      apply(data.user?.id ?? null, data.user?.email ?? null);

      const sub = c.auth.onAuthStateChange((_event, session) => {
        invalidateRepos();
        // A new identity must never read the previous one's cached profile.
        clearProfileCache();
        apply(session?.user?.id ?? null, session?.user?.email ?? null);
      });
      unsub = () => sub.data.subscription.unsubscribe();
    })();

    return () => {
      alive = false;
      unsub?.();
    };
  }, [configured]);

  const role = profile?.role ?? null;
  return {
    configured,
    email,
    userId,
    loading: email === undefined,
    profile,
    role,
    isAdmin: role === "admin" || role === "owner",
  };
}

/**
 * Send a magic link. Returns an error message, or null on success.
 *
 * Kept for the sync dialog, which frames sign-in as opt-in cross-device sync
 * rather than as entry to the product. The `/login` surfaces call
 * `sendEmailCode` in `lib/auth/actions.ts` instead, which distinguishes signing
 * in from registering.
 */
export async function sendMagicLink(
  email: string,
  next?: string | null,
): Promise<string | null> {
  const c = await getSupabaseBrowser();
  if (!c) return "Sync isn't configured for this deployment.";
  const dest = safeNext(next);
  const { error } = await c.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(dest)}`,
    },
  });
  return friendlyAuthError(error?.message);
}

export async function signOut(): Promise<void> {
  clearProfileCache();
  await signOutEverywhere();
}
