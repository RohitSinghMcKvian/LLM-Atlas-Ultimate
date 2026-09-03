import Link from "next/link";
import { AppLink } from "@/components/nav/app-link";
import { Github, Twitter, MessageCircle } from "lucide-react";
import { BrandLockup } from "@/components/brand/logo";
import { MODULE_GROUPS, modulesByGroup } from "@/lib/modules";

const RESOURCES = [
  { label: "Docs", href: "/docs" },
  { label: "API Reference", href: "/docs" },
  { label: "Roadmap", href: "/docs" },
  { label: "Changelog", href: "/news" },
  { label: "Status", href: "/docs" },
];

const COMMUNITY = [
  { label: "GitHub", href: "https://github.com" },
  { label: "Discord", href: "#" },
  { label: "Contributing", href: "/docs" },
  { label: "Atlas Hub", href: "/hub" },
];

export function Footer() {
  return (
    <footer className="relative border-t border-border bg-surface/30">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-action/50 to-transparent" />
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2.6fr]">
          <div>
            <BrandLockup size={30} />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              The open ecosystem for everything LLM — learn, research, compare,
              cost, and build in one workspace you can self-host.
            </p>
            <div className="mt-5 flex gap-2">
              {[
                { icon: Github, href: "https://github.com", label: "GitHub" },
                { icon: Twitter, href: "#", label: "X" },
                { icon: MessageCircle, href: "#", label: "Discord" },
              ].map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={s.label}
                  className="grid size-9 place-items-center rounded-lg border border-border bg-surface-2/60 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                >
                  <s.icon className="size-4" />
                </a>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {MODULE_GROUPS.map((group) => (
              <div key={group}>
                <p className="mb-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group}
                </p>
                <ul className="space-y-2">
                  {modulesByGroup(group).map((m) => (
                    <li key={m.id}>
                      <AppLink
                        href={m.href}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {m.label}
                      </AppLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 grid gap-8 border-t border-border pt-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="mb-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Resources
            </p>
            <ul className="space-y-2">
              {RESOURCES.map((r) => (
                <li key={r.label}>
                  <Link
                    href={r.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {r.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Community
            </p>
            <ul className="space-y-2">
              {COMMUNITY.map((c) => (
                <li key={c.label}>
                  <a
                    href={c.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <p className="mb-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              License
            </p>
            <p className="text-sm text-muted-foreground">
              Code under the <span className="text-foreground">MIT License</span>.
              Course content under CC BY-SA. “Atlas Certified” is a self-branded
              credential — not affiliated with MIT the institution.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} LLM Atlas · llmatlas.xyz</p>
          <p className="flex items-center gap-1.5">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-success" />
            All systems operational
          </p>
        </div>
      </div>
    </footer>
  );
}
