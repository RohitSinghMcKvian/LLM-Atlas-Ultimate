"use client";

import * as React from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Copy,
  Check,
  Trash2,
  Files,
  Save,
  History,
  Variable,
  PlayCircle,
  Library,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  usePromptStore,
  latest,
  extractVars,
  render,
  type Prompt,
} from "@/lib/store/prompt-store";
import { useMounted } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

export function PromptClient() {
  const mounted = useMounted();
  const prompts = usePromptStore((s) => s.prompts);
  const saveVersion = usePromptStore((s) => s.saveVersion);
  const updateMeta = usePromptStore((s) => s.updateMeta);
  const remove = usePromptStore((s) => s.remove);
  const duplicate = usePromptStore((s) => s.duplicate);
  const add = usePromptStore((s) => s.add);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [note, setNote] = React.useState("");
  const [vars, setVars] = React.useState<Record<string, string>>({});
  const [copied, setCopied] = React.useState(false);

  const selected = prompts.find((p) => p.id === selectedId) ?? prompts[0] ?? null;

  React.useEffect(() => {
    if (selected) setDraft(latest(selected).body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const detectedVars = extractVars(draft);
  const rendered = render(draft, vars);
  const dirty = selected ? draft !== latest(selected).body : false;

  const filtered = prompts.filter(
    (p) =>
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some((t) => t.includes(search.toLowerCase())),
  );

  if (!mounted) {
    return (
      <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
        <div className="h-8 w-40 animate-pulse rounded bg-surface-2" />
        <div className="mt-6 h-64 animate-pulse rounded-2xl bg-surface-2/60" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Prompt
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A versioned prompt library with variables — shared across Chat, Code,
            and Flow.
          </p>
        </div>
        <NewPromptDialog onCreate={(p) => { add(p); setSelectedId(p.id); }} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Library list */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts…"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1.5 lg:overflow-visible">
            {filtered.map((p) => {
              const active = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "shrink-0 rounded-xl border p-3 text-left transition-colors lg:w-full",
                    active
                      ? "border-cyan/40 bg-surface-2"
                      : "border-border bg-surface/50 hover:border-border-strong",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.title}</span>
                    <Badge variant="default" className="ml-auto shrink-0 text-2xs">
                      v{latest(p).v}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <span key={t} className="text-2xs text-muted-foreground">
                        #{t}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Editor */}
        {selected ? (
          <div className="min-w-0 space-y-4">
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <input
                  value={selected.title}
                  onChange={(e) => updateMeta(selected.id, { title: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent font-display text-lg font-semibold outline-none"
                />
                <Badge variant="primary">v{latest(selected).v}</Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    const nid = duplicate(selected.id);
                    if (nid) setSelectedId(nid);
                  }}
                  title="Duplicate"
                >
                  <Files className="size-4" />
                </Button>
                {prompts.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => {
                      remove(selected.id);
                      setSelectedId(null);
                    }}
                    title="Delete"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>

              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                className="w-full resize-y rounded-xl border border-border bg-[#0b0d14] p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-cyan/40"
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What changed? (version note)"
                  className="h-9 max-w-xs flex-1"
                />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!dirty}
                  onClick={() => {
                    saveVersion(selected.id, draft, note);
                    setNote("");
                  }}
                >
                  <Save className="size-4" /> Save v{latest(selected).v + 1}
                </Button>
              </div>
            </Card>

            {/* Variables + preview */}
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Variable className="size-4 text-violet" /> Variables
                {detectedVars.length === 0 && (
                  <span className="text-2xs font-normal text-muted-foreground">
                    add {"{{name}}"} placeholders in the body
                  </span>
                )}
              </div>
              {detectedVars.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {detectedVars.map((v) => (
                    <div key={v}>
                      <label className="mb-1 block font-mono text-2xs text-muted-foreground">
                        {`{{${v}}}`}
                      </label>
                      <Input
                        value={vars[v] ?? ""}
                        onChange={(e) => setVars((s) => ({ ...s, [v]: e.target.value }))}
                        placeholder={`value for ${v}`}
                        className="h-9"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                    Preview
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(rendered);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                      Copy
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/playground?prompt=${encodeURIComponent(rendered)}`}>
                        <PlayCircle className="size-3.5" /> Playground
                      </Link>
                    </Button>
                  </div>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-surface-2/40 p-3 text-[13px] leading-relaxed">
                  {rendered}
                </pre>
              </div>
            </Card>

            {/* Version history */}
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <History className="size-4 text-cyan" /> Version history
              </div>
              <div className="space-y-1.5">
                {[...selected.versions].reverse().map((ver) => (
                  <button
                    key={ver.v}
                    onClick={() => setDraft(ver.body)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-border-strong"
                  >
                    <Badge variant="default" className="shrink-0">v{ver.v}</Badge>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {ver.note}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                      {ver.date}
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <Library className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No prompt selected. Create one to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function NewPromptDialog({
  onCreate,
}: {
  onCreate: (p: { id: string; title: string; tags: string[]; body: string }) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [body, setBody] = React.useState("");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="size-4" /> New prompt
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New prompt</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
          />
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags (comma-separated)"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="Prompt body — use {{variables}} for fill-ins"
            className="w-full resize-y rounded-xl border border-border bg-[#0b0d14] p-3 font-mono text-[13px] outline-none focus:border-cyan/40"
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              variant="primary"
              disabled={!title.trim() || !body.trim()}
              onClick={() =>
                onCreate({
                  id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${Date.now()}`,
                  title: title.trim(),
                  tags: tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
                  body,
                })
              }
            >
              Create
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
