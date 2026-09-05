"use client";

import * as React from "react";
import { useCatalogSnapshot } from "@/lib/hooks/use-catalog-snapshot";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Sparkles,
  Flame,
  Gift,
  Crown,
  Clock,
  KeyRound,
  MessagesSquare,
  GitCompareArrows,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ModelLifecycleBadge } from "@/components/catalog/model-lifecycle-badge";
import { SyncPill } from "@/components/catalog/catalog-updates";
import { Button } from "@/components/ui/button";
import {
  freeModels,
  byokModels,
  trendingModels,
  newModels,
  modelAccess,
  intelligenceIndex,
} from "@/lib/catalog";
import type { CatalogModel } from "@/lib/catalog/types";
import { useKeysStore } from "@/lib/store/keys-store";
import { ACCENT_TEXT } from "@/lib/accent";
import { cn, formatContext } from "@/lib/utils";

export function HubClient() {
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const hasKey = useKeysStore((s) => s.keyPresent);

  // One subscription drives every rail: a synced snapshot is a new object
  // identity, so all five memos below recompute exactly once when it lands.
  const snapshot = useCatalogSnapshot();

  // Memoized, not called inline: at ~400 models `newModels` sorts the whole
  // catalog, and these rails re-render on every key-modal toggle.
  const trending = React.useMemo(() => trendingModels(), [snapshot]);
  const fresh = React.useMemo(() => newModels(120), [snapshot]);
  const free = React.useMemo(
    () => byIntelligence(freeModels()).slice(0, 12),
    [snapshot],
  );
  const frontier = React.useMemo(
    () => byIntelligence(byokModels()).slice(0, 12),
    [snapshot],
  );

  // Straight off the snapshot rather than re-scanning the catalog: the sync
  // already computed these.
  const stats = React.useMemo(
    () => ({
      total: snapshot.stats.models - snapshot.stats.upcoming,
      free: snapshot.stats.free,
      byok: snapshot.stats.byok,
    }),
    [snapshot],
  );

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      {/* Hero */}
      <div className="mb-8 overflow-hidden rounded-3xl border border-border bg-action/10 p-6 sm:p-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant="primary">
            <Sparkles className="size-3" /> Orchestrator home
          </Badge>
          {/* Where the catalog comes from, said out loud. The counts above are a
              live number that changes daily; without this the reader has no way
              to know that, or when it last moved. */}
          <SyncPill />
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Every model, one workspace
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          <span className="font-medium text-accent">{stats.free} open models free</span>{" "}
          to run — permanently, on Atlas&apos;s own provider keys — plus {stats.byok}{" "}
          frontier models with your own key. The list refreshes itself: models a
          provider adds show up here tagged New, and models a provider retires
          leave.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Button asChild variant="primary">
            <Link href="/leaderboard">
              Browse all {stats.total} models <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button variant="secondary" onClick={() => setKeyModalOpen(true)}>
            <KeyRound className="size-4" />
            {hasKey ? "OpenRouter key connected" : "Connect your key for paid models"}
          </Button>
        </div>
      </div>

      <div className="space-y-9">
        <Rail
          icon={Flame}
          tone="ridge"
          title="Trending"
          subtitle="What the community is reaching for right now"
          models={trending}
        />
        {fresh.length > 0 && (
          <Rail
            icon={Clock}
            tone="shelf"
            title="New & Notable"
            subtitle="Recently added to the Atlas catalog"
            models={fresh.slice(0, 12)}
          />
        )}
        <Rail
          icon={Gift}
          tone="success"
          title="Free open models"
          subtitle="Open weights, served on the Atlas key — no key needed"
          models={free}
          cta={{ label: "All free models", href: "/leaderboard?access=free" }}
        />
        <Rail
          icon={Crown}
          tone="upland"
          title="Frontier · bring your own key"
          subtitle="The strongest closed models, on your OpenRouter account"
          models={frontier}
          onConnect={!hasKey ? () => setKeyModalOpen(true) : undefined}
        />
      </div>
    </div>
  );
}

function Rail({
  icon: Icon,
  tone,
  title,
  subtitle,
  models,
  cta,
  onConnect,
}: {
  icon: React.ElementType;
  tone: "ridge" | "shelf" | "upland" | "success";
  title: string;
  subtitle: string;
  models: CatalogModel[];
  cta?: { label: string; href: string };
  onConnect?: () => void;
}) {
  if (models.length === 0) return null;
  const toneCls = { ...ACCENT_TEXT, success: "text-success" }[tone];

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("grid size-8 place-items-center rounded-xl bg-surface-2", toneCls)}>
            <Icon className="size-4" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {onConnect ? (
          <button
            onClick={onConnect}
            className="shrink-0 text-xs font-medium text-action hover:underline"
          >
            Connect key →
          </button>
        ) : cta ? (
          <Link href={cta.href} className="shrink-0 text-xs font-medium text-action hover:underline">
            {cta.label} →
          </Link>
        ) : null}
      </div>

      <div className="flex snap-x gap-3 overflow-x-auto pb-2 no-scrollbar">
        {models.map((m, i) => (
          <ModelCard key={m.id} model={m} index={i} />
        ))}
      </div>
    </section>
  );
}

function ModelCard({ model, index }: { model: CatalogModel; index: number }) {
  const free = modelAccess(model) === "free";
  const intel = intelligenceIndex(model);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className="flex w-[240px] shrink-0 snap-start flex-col rounded-2xl border border-border bg-surface/50 p-4 transition-colors hover:border-border-strong"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-medium">
            <span className="truncate">{model.name}</span>
            <ModelLifecycleBadge model={model} compact className="shrink-0" />
          </p>
          <p className="truncate text-xs text-muted-foreground">{model.provider}</p>
        </div>
        <Badge variant={free ? "success" : "accent"} className="shrink-0">
          {free ? "Free" : "Your key"}
        </Badge>
      </div>

      <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{model.blurb}</p>

      <div className="mb-3 mt-auto flex items-center gap-2 text-2xs text-muted-foreground">
        <span className="font-mono">{formatContext(model.contextWindow)} ctx</span>
        {intel > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span className="font-mono">intel {intel}</span>
          </>
        )}
        {model.trending && (
          <Badge variant="primary" className="ml-auto">
            <Flame className="size-3" /> Hot
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="primary" size="sm">
          <Link href={`/chat?model=${model.id}`}>
            <MessagesSquare className="size-3.5" /> Chat
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/compare?models=${model.id}`}>
            <GitCompareArrows className="size-3.5" /> Compare
          </Link>
        </Button>
      </div>
    </motion.div>
  );
}

function byIntelligence(list: CatalogModel[]): CatalogModel[] {
  return [...list].sort((a, b) => intelligenceIndex(b) - intelligenceIndex(a));
}
