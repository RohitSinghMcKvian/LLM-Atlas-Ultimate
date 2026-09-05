import type { Metadata } from "next";
import { Shield, Users, Newspaper } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getProfile } from "@/lib/auth/session";
import { CatalogSyncCard } from "@/components/admin/catalog-sync-card";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

/**
 * The admin landing.
 *
 * The catalog-sync card is real and operable. The rest is still a map of what
 * belongs here next: an empty shell that *looks* operable would be worse than
 * one that says plainly what it is.
 */
export default async function AdminPage() {
  // Safe to call again: the layout guard already ran, and this is a cached read
  // within the same request.
  const profile = await getProfile();

  const planned = [
    {
      icon: Users,
      title: "Accounts",
      body: "Search accounts, review sign-in methods, and grant or revoke the admin role.",
    },
    {
      icon: Newspaper,
      title: "News sync",
      body: "Same for the news pipeline, including the cooldown that gates public refreshes.",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
          <Shield className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">Admin</h1>
            {profile && (
              <Badge variant="accent" className="capitalize">
                {profile.role}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="text-foreground">
              {profile?.display_name?.trim() || profile?.email || "an admin"}
            </span>
            . Everyone else is redirected before this page renders.
          </p>
        </div>
      </div>

      {/* Built, not planned. */}
      <div className="mt-8">
        <CatalogSyncCard />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {planned.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>{body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <p className="mt-8 rounded-xl border border-border bg-surface-2/50 p-3.5 text-sm text-muted-foreground">
        Roles live in <code className="font-mono text-2xs">profiles.role</code> and
        cannot be raised from the app — migration 0011 pins the column against
        self-promotion. Grant the first admin from the Supabase SQL editor.
      </p>
    </div>
  );
}
