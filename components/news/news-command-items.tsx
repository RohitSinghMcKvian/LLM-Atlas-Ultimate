"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CommandGroup, CommandItem, CommandShortcut } from "@/components/ui/command";
import { relativeTime } from "@/lib/news/format";

// The live headlines group in ⌘K.
//
// Loaded with `next/dynamic({ ssr: false })` from the palette, so a reader who
// opens ⌘K on /chat or /code never pays for the news fetch — and the palette's
// static News group is already on screen while this resolves.
//
// The fetch is shared through a module-level cache with a single in-flight
// promise, the same pattern as `lib/hooks/use-providers.ts`: the palette mounts
// and unmounts constantly and must not re-request on every ⌘K.

interface Headline {
  id: string;
  title: string;
  domain: string;
  sourceName: string;
  publishedAt: string;
  level: string;
}

let cache: Headline[] | null = null;
let cachedAt = 0;
let inflight: Promise<void> | null = null;
const subscribers = new Set<(items: Headline[]) => void>();

/** The corpus only changes hourly; anything fresher than this is still current. */
const TTL_MS = 5 * 60_000;

function load(): void {
  if (inflight) return;
  if (cache && Date.now() - cachedAt < TTL_MS) return;

  inflight = fetch("/api/v1/news?fields=headlines&limit=6")
    .then((r) => r.json())
    .then((data) => {
      cache = Array.isArray(data.headlines) ? data.headlines : [];
      cachedAt = Date.now();
    })
    .catch(() => {
      // A palette missing its headlines group is a non-event. Deliberately not
      // cached, so the next ⌘K retries after a transient failure.
    })
    .finally(() => {
      inflight = null;
      for (const notify of subscribers) notify(cache ?? []);
    });
}

export function NewsCommandItems({ onSelect }: { onSelect: (run: () => void) => void }) {
  const router = useRouter();
  const [items, setItems] = React.useState<Headline[]>(cache ?? []);

  React.useEffect(() => {
    let active = true;
    const apply = (next: Headline[]) => {
      if (active) setItems(next);
    };

    if (cache && Date.now() - cachedAt < TTL_MS) {
      apply(cache);
      return () => {
        active = false;
      };
    }

    subscribers.add(apply);
    load();
    return () => {
      active = false;
      subscribers.delete(apply);
    };
  }, []);

  if (!items.length) return null;

  return (
    <CommandGroup heading="Latest AI news">
      {items.map((item) => (
        <CommandItem
          key={item.id}
          // cmdk matches on this rather than on rendered children, so the
          // publisher is searchable even though it is rendered as a shortcut.
          value={`${item.title} ${item.sourceName} ${item.domain}`}
          onSelect={() => onSelect(() => router.push(`/news/${item.id}`))}
        >
          <span className="truncate">{item.title}</span>
          <CommandShortcut className="shrink-0 font-mono text-2xs">
            {relativeTime(item.publishedAt)}
          </CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
