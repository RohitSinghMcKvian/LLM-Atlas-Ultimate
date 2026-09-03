"use client";

import * as React from "react";
import {
  Bookmark,
  GitCommitVertical,
  ImageIcon,
  Grid3x3,
  LayoutGrid,
  Rows3,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TOPIC_IDS } from "@/lib/news/topics";
import { hasActiveFilters } from "@/lib/news/select";
import type {
  NewsFilterState,
  NewsSort,
  NewsSourceSummary,
  NewsTopic,
  NewsView,
} from "@/lib/news/types";
import { cn } from "@/lib/utils";
import { NewsSourceFilter } from "./news-source-filter";
import { NewsTopicChip } from "./news-topic-chip";

const SORT_LABELS: Record<NewsSort, string> = {
  top: "Top",
  latest: "Latest",
  verified: "Most verified",
  corroborated: "Most corroborated",
};

const VIEW_OPTIONS: { view: NewsView; label: string; Icon: typeof LayoutGrid }[] = [
  { view: "magazine", label: "Magazine", Icon: LayoutGrid },
  { view: "grid", label: "Grid", Icon: Grid3x3 },
  { view: "compact", label: "Compact", Icon: Rows3 },
  { view: "timeline", label: "Timeline", Icon: GitCommitVertical },
];

export interface NewsFilterBarProps {
  filters: NewsFilterState;
  topicCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  sources: readonly NewsSourceSummary[];
  showing: number;
  total: number;
  savedCount: number;
  searchRef?: React.RefObject<HTMLInputElement>;
  onChange: (patch: Partial<NewsFilterState>) => void;
  onClear: () => void;
}

export function NewsFilterBar(props: NewsFilterBarProps) {
  const { filters, showing, total, onClear } = props;
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const active = hasActiveFilters(filters);

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur-xl sm:-mx-6 sm:px-6">
      <div className="flex items-center gap-2">
        {/* Topic chips. Horizontally scrollable rather than wrapping, so the bar
            keeps a fixed height and the feed below never jumps. */}
        <div className="mask-fade-r hidden min-w-0 flex-1 overflow-x-auto md:block">
          <div className="flex gap-1.5 pb-0.5">
            <TopicChips {...props} />
          </div>
        </div>

        {/* Below md the chips move into a bottom sheet with everything else. */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 md:hidden"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          Filters
          {active && <span className="size-1.5 rounded-full bg-action" aria-hidden="true" />}
        </Button>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <SearchBox {...props} />
          <div className="hidden items-center gap-2 lg:flex">
            <SortSelect {...props} />
            <NewsSourceFilter
              sources={props.sources}
              counts={props.sourceCounts}
              selected={filters.sources}
              onChange={(sources) => props.onChange({ sources })}
            />
          </div>
          <ViewTabs {...props} />
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3 text-2xs text-muted-foreground">
        <span className="tnum">
          Showing <strong className="font-medium text-foreground">{showing}</strong> of {total}
        </span>

        <div className="hidden items-center gap-3 sm:flex">
          <VerifiedToggle {...props} />
          <ImagesToggle {...props} />
          <SavedToggle {...props} />
        </div>

        {active && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-3" aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>

      {/* Mobile: a Dialog restyled as a bottom sheet. There is no sheet
          primitive in the repo, and adding one for a single consumer is not
          worth the surface area — DialogContent already brings the focus trap,
          Esc handling and scroll lock that matter here. */}
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="inset-x-0 bottom-0 left-0 top-auto max-h-[80vh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none rounded-t-3xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom">
          <DialogTitle className="font-display text-base">Filter stories</DialogTitle>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Topics</p>
              <div className="flex flex-wrap gap-1.5">
                <TopicChips {...props} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <SortSelect {...props} />
              <NewsSourceFilter
                sources={props.sources}
                counts={props.sourceCounts}
                selected={filters.sources}
                onChange={(sources) => props.onChange({ sources })}
              />
            </div>

            <div className="flex flex-col gap-3 text-xs">
              <VerifiedToggle {...props} />
              <ImagesToggle {...props} />
              <SavedToggle {...props} />
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={onClear} disabled={!active}>
                Clear all
              </Button>
              <Button variant="primary" className="flex-1" onClick={() => setSheetOpen(false)}>
                Show {showing}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TopicChips({ filters, topicCounts, onChange }: NewsFilterBarProps) {
  const toggle = (topic: NewsTopic) => {
    onChange({
      topics: filters.topics.includes(topic)
        ? filters.topics.filter((t) => t !== topic)
        : [...filters.topics, topic],
    });
  };

  return (
    <>
      {TOPIC_IDS.map((topic, index) => (
        <NewsTopicChip
          key={topic}
          topic={topic}
          count={topicCounts[topic] ?? 0}
          active={filters.topics.includes(topic)}
          shortcut={index + 1}
          onToggle={toggle}
        />
      ))}
    </>
  );
}

function SearchBox({ filters, onChange, searchRef }: NewsFilterBarProps) {
  // Local state so typing stays responsive; the expensive re-filter is debounced.
  const [value, setValue] = React.useState(filters.query);

  React.useEffect(() => setValue(filters.query), [filters.query]);

  React.useEffect(() => {
    if (value === filters.query) return;
    const timer = setTimeout(() => onChange({ query: value }), 120);
    return () => clearTimeout(timer);
  }, [value, filters.query, onChange]);

  return (
    <div className="relative w-36 sm:w-52">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={searchRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            onChange({ query: "" });
            e.currentTarget.blur();
          }
        }}
        placeholder="Search  /"
        aria-label="Search stories, sources, domains and models"
        className="h-8 pl-8 pr-7 text-xs"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            onChange({ query: "" });
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SortSelect({ filters, onChange }: NewsFilterBarProps) {
  return (
    <Select value={filters.sort} onValueChange={(sort) => onChange({ sort: sort as NewsSort })}>
      <SelectTrigger className="h-8 w-auto min-w-[7.5rem] text-xs" aria-label="Sort stories">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(SORT_LABELS) as NewsSort[]).map((sort) => (
          <SelectItem key={sort} value={sort} className="text-xs">
            {SORT_LABELS[sort]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ViewTabs({ filters, onChange }: NewsFilterBarProps) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5"
      role="group"
      aria-label="Feed layout"
    >
      {VIEW_OPTIONS.map(({ view, label, Icon }) => (
        <Tooltip key={view}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onChange({ view })}
              aria-pressed={filters.view === view}
              aria-label={`${label} layout`}
              className={cn(
                "grid size-7 place-items-center rounded-md transition-colors",
                filters.view === view
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {label} <span className="text-muted-foreground">· g cycles</span>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function VerifiedToggle({ filters, onChange }: NewsFilterBarProps) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <Switch
        checked={filters.verifiedOnly}
        onCheckedChange={(verifiedOnly) => onChange({ verifiedOnly })}
        aria-label="Show only verified and corroborated stories"
      />
      <ShieldCheck className="size-3" aria-hidden="true" />
      Verified only
    </label>
  );
}

/**
 * The image gate.
 *
 * Phrased as "With images" rather than "Hide imageless stories" because the
 * switch is ON by default, and a default-on control should read as a description
 * of what you are looking at, not as a suppression you have to reason about.
 */
function ImagesToggle({ filters, onChange }: NewsFilterBarProps) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <Switch
        checked={filters.imagesOnly}
        onCheckedChange={(imagesOnly) => onChange({ imagesOnly })}
        aria-label="Show only stories that have a publisher image"
      />
      <ImageIcon className="size-3" aria-hidden="true" />
      With images
    </label>
  );
}

function SavedToggle({ filters, savedCount, onChange }: NewsFilterBarProps) {
  return (
    <label
      className={cn(
        "flex items-center gap-1.5",
        savedCount === 0 ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <Switch
        checked={filters.savedOnly}
        disabled={savedCount === 0}
        onCheckedChange={(savedOnly) => onChange({ savedOnly })}
        aria-label="Show only saved stories"
      />
      <Bookmark className="size-3" aria-hidden="true" />
      Saved
      {savedCount > 0 && <span className="tnum">({savedCount})</span>}
    </label>
  );
}
