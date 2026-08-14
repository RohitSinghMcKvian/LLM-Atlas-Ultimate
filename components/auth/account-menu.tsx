"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Github, LogOut, Shield, KeyRound, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAuth, signOut } from "@/lib/hooks/use-auth";
import { useKeysStore } from "@/lib/store/keys-store";
import { signInUrlFor } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

/**
 * Topbar identity.
 *
 * Replaces the hardcoded initial and name that stood in while there was no
 * login. Signed out it is a sign-in link carrying the current route, so getting
 * an account never costs you your place.
 *
 * The `Admin` item is a convenience, not a gate — `requireAdmin()` in the admin
 * layout is what actually decides. Hiding the link from non-admins just keeps a
 * door out of view that would only close in their face.
 */
export function AccountMenu({ className }: { className?: string }) {
  const { configured, email, profile, loading, isAdmin } = useAuth();
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  const name = profile?.display_name?.trim() || null;
  const label = name ?? email ?? null;
  const initial = (name ?? email ?? "?").trim().charAt(0).toUpperCase();

  // Signed out — and on a deployment with no Supabase there is nothing to sign
  // into, so the control disappears rather than leading somewhere inert.
  if (!configured) return null;

  if (!loading && !email) {
    return (
      <Link
        href={signInUrlFor(pathname)}
        className={cn(
          "inline-flex h-9 items-center rounded-lg bg-action px-3.5 text-sm",
          "font-semibold text-action-foreground transition-all duration-200",
          "hover:brightness-110 active:scale-[0.98]",
          className,
        )}
      >
        Sign in
      </Link>
    );
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    // Land somewhere public: staying put on a gated route would immediately
    // bounce through middleware to sign-in, which reads as a failure.
    router.push("/");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label ? `Account: ${label}` : "Account"}
        className={cn(
          "relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full",
          "bg-action text-sm font-semibold text-action-foreground",
          "transition-transform duration-200 hover:scale-105",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
          "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className,
        )}
      >
        {profile?.avatar_url ? (
          // Not next/image: the host is whatever provider the account came from,
          // and adding every OAuth CDN to `images.remotePatterns` to save a few
          // kilobytes on a 36px avatar is not a trade worth making.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          initial
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="normal-case">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {name ?? "Signed in"}
            </span>
            {isAdmin && (
              <Badge variant="accent" className="shrink-0">
                Admin
              </Badge>
            )}
          </div>
          {email && (
            <div className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield />
              Admin
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setKeyModalOpen(true)}>
          <KeyRound />
          Atlas Vault · API keys
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="https://github.com" target="_blank" rel="noreferrer">
            <Github />
            Star on GitHub
          </a>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(e) => {
            // Keep the menu up while the request is in flight, so the spinner
            // is somewhere the user can still see it.
            e.preventDefault();
            void handleSignOut();
          }}
        >
          {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
