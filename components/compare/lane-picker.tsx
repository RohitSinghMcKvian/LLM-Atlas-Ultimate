"use client";

import * as React from "react";
import { Coins, KeyRound, Plus, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { browseModels } from "@/lib/catalog/search";
import type { RouteEnv } from "@/lib/catalog/availability";
import { MAX_LANES } from "@/lib/compare/types";
import { formatContext } from "@/lib/utils";

/**
 * Add a model to the run.
 *
 * The picker this replaces listed `routableModels()` with nothing but a name and
 * a provider, so a model that would answer 402 the moment you ran it looked
 * exactly like one that would work. This asks `browseModels(env, …)` — the same
 * availability function the server uses to decide who pays — so the row says
 * whether it is free, needs your key, or cannot run here at all, before you
 * spend anything finding out.
 */

export function LanePicker({
  selected,
  onToggle,
  env,
  disabled,
}: {
  selected: string[];
  onToggle: (id: string) => void;
  env: RouteEnv | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const full = selected.length >= MAX_LANES;

  // `env` is null until `/api/v1/providers` answers. Browsing with an empty env
  // would label everything "needs a key", so the list waits rather than lying.
  const rows = React.useMemo(() => {
    if (!env) return [];
    return browseModels(env, { query }).rows.filter((r) => !selected.includes(r.model.id)).slice(0, 60);
  }, [env, query, selected]);

  const groups = React.useMemo(
    () => ({
      free: rows.filter((r) => r.availability.kind === "free"),
      key: rows.filter((r) => r.availability.kind === "your_key" || r.availability.kind === "needs_key"),
    }),
    [rows],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled || full}
          title={full ? `A run compares at most ${MAX_LANES} models.` : undefined}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-action hover:text-foreground disabled:opacity-50"
        >
          <Plus className="size-3" /> {full ? `${MAX_LANES} is the limit` : "Add model"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search every model…" value={query} onValueChange={setQuery} />
          <CommandList>
            {env && rows.length === 0 && <CommandEmpty>No model matches.</CommandEmpty>}
            {!env && <div className="p-4 text-xs text-muted-foreground">Checking providers…</div>}

            {groups.free.length > 0 && (
              <CommandGroup heading="Free to run">
                {groups.free.map(({ model }) => (
                  <CommandItem
                    key={model.id}
                    value={model.id}
                    onSelect={() => {
                      onToggle(model.id);
                      setQuery("");
                    }}
                  >
                    <Sparkles />
                    <span className="truncate">{model.name}</span>
                    <span className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
                      {formatContext(model.contextWindow)}
                      <span className="text-elev-2">free</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {groups.key.length > 0 && (
              <CommandGroup heading="Billed to your key">
                {groups.key.map(({ model, availability }) => (
                  <CommandItem
                    key={model.id}
                    value={model.id}
                    onSelect={() => {
                      onToggle(model.id);
                      setQuery("");
                    }}
                  >
                    {availability.kind === "needs_key" ? <KeyRound /> : <Coins />}
                    <span className="truncate">{model.name}</span>
                    <span className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
                      {formatContext(model.contextWindow)}
                      <span>${model.pricing.outputPerM}/M</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
