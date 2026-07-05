"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  RefreshCw,
  ExternalLink,
  Sparkles,
  TrendingDown,
  AlertTriangle,
  Plus,
  Check,
  Radio,
  ArrowUpRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/lib/hooks/use-media-query";
import {
  NEWS,
  TOPICS,
  FOLLOW_PROVIDERS,
  type NewsItem,
  type NewsTopic,
} from "@/lib/news/data";
import { getModelById } from "@/lib/catalog";
import { cn } from "@/lib/utils";

const DIFF_STYLE = {
  new_model: {
    icon: Plus,
    label: "New model",
    border: "border-l-success",
    text: "text-success",
    bg: "bg-success/5",
  },
  price_change: {
    icon: TrendingDown,
    label: "Price change",
    border: "border-l-cyan",
    text: "text-cyan",
    bg: "bg-cyan/5",
  },
  deprecation: {
    icon: AlertTriangle,
    label: "Deprecation",
    border: "border-l-amber",
    text: "text-amber",
    bg: "bg-amber/5",
  },
} as const;

export function NewsClient() {
  const mounted = useMounted();
  const [topic, setTopic] = React.useState<NewsTopic | "all">("all");
  const [following, setFollowing] = React.useState<Set<string>>(
    new Set(["Anthropic", "DeepSeek"]),
  );
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [syncedAt, setSyncedAt] = React.useState(8);

  React.useEffect(() => {
    const t = setInterval(() => setSyncedAt((s) => s + 1), 60000);
    return () => clearInterval(t);
  }, [refreshKey]);

  const items = React.useMemo(
    () => (topic === "all" ? NEWS : NEWS.filter((n) => n.topics.includes(topic))),
    [topic],
  );

  function toggleFollow(p: string) {
    setFollowing((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            News
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hourly-syncing, de-duplicated AI news — neutral summaries, fully
            attributed.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2/60 px-3 py-1.5 text-xs text-muted-foreground">
            <Radio className="size-3.5 text-success" />
            {mounted ? `synced ${syncedAt}m ago` : "live"}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setRefreshKey((k) => k + 1);
              setSyncedAt(0);
            }}
          >
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* Topic filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        <Chip active={topic === "all"} onClick={() => setTopic("all")}>
          All
        </Chip>
        {TOPICS.map((t) => (
          <Chip
            key={t.id}
            active={topic === t.id}
            onClick={() => setTopic(t.id)}
          >
            {t.label}
          </Chip>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Feed */}
        <div key={refreshKey} className="columns-1 gap-4 sm:columns-2 lg:columns-2 2xl:columns-3">
          {items.map((item, i) => (
            <NewsCard key={item.id} item={item} index={i} />
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">No stories in this topic.</p>
          )}
        </div>

        {/* Follow rail */}
        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-border bg-surface/50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Follow providers
            </p>
            <div className="flex flex-wrap gap-2">
              {FOLLOW_PROVIDERS.map((p) => {
                const on = following.has(p);
                return (
                  <button
                    key={p}
                    onClick={() => toggleFollow(p)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                      on
                        ? "border-cyan/40 bg-cyan/10 text-cyan"
                        : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                    )}
                  >
                    {on ? <Check className="size-3" /> : <Plus className="size-3" />}
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface/50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Trending models
            </p>
            <div className="space-y-1">
              {["deepseek-v4-pro", "claude-opus-4-8", "gemini-3-1-pro", "gpt-5-5"].map(
                (id, i) => {
                  const m = getModelById(id);
                  if (!m) return null;
                  return (
                    <Link
                      key={id}
                      href={`/compare?models=${id}`}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface-2"
                    >
                      <span className="w-4 font-mono text-xs text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="truncate">{m.name}</span>
                      <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground" />
                    </Link>
                  );
                },
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-amber/25 bg-amber/5 p-4 text-sm">
            <p className="font-medium">Hourly digest</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Get a once-an-hour summary of what changed, by email or webhook.
            </p>
            <Button variant="secondary" size="sm" className="mt-3 w-full">
              Enable digest
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function NewsCard({ item, index }: { item: NewsItem; index: number }) {
  const diff = item.diff ? DIFF_STYLE[item.diff.kind] : null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.4), ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "mb-4 break-inside-avoid rounded-2xl border bg-surface/50 p-4 transition-colors hover:border-border-strong",
        diff ? cn("border-l-2 border-border", diff.border, diff.bg) : "border-border",
      )}
    >
      {diff && (
        <div className={cn("mb-2 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide", diff.text)}>
          <diff.icon className="size-3.5" /> {diff.label}
        </div>
      )}

      <div className="mb-2 flex items-center gap-2 text-2xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{item.source}</span>
        <span>·</span>
        <span>{item.ago} ago</span>
        {item.corroboration && item.corroboration > 1 && (
          <span className="ml-auto rounded-full bg-surface-2 px-1.5 py-0.5">
            {item.corroboration} sources
          </span>
        )}
      </div>

      <h3 className="font-display text-base font-semibold leading-snug tracking-tight">
        {item.title}
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{item.summary}</p>

      {item.diff && (
        <div className={cn("mt-3 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-2xs", diff?.text)}>
          {item.diff.detail}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {item.topics.slice(0, 3).map((t) => (
          <Badge key={t} variant="default" className="text-2xs">
            {t}
          </Badge>
        ))}
        {item.models?.map((id) => {
          const m = getModelById(id);
          if (!m) return null;
          return (
            <Link key={id} href={`/compare?models=${id}`}>
              <Badge variant="primary" className="text-2xs hover:bg-cyan/20">
                {m.name}
              </Badge>
            </Link>
          );
        })}
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
        >
          source <ExternalLink className="size-3" />
        </a>
      </div>
    </motion.article>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-transparent bg-gradient-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
