"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  Send,
  Square,
  Search,
  MessageSquare,
  Sparkles,
  Paperclip,
  Pin,
  Code2,
  History,
  User,
  AlertCircle,
  Trash2,
  Pencil,
  X,
  ArrowDown,
  Copy,
  Check,
  FileText,
  Image as ImageIcon,
  Table2,
  Loader2,
  Globe,
  Brain,
  FolderGit2,
  Settings2,
  Download,
  RefreshCw,
  Mic,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Zap,
  ArrowRightFromLine,
  Activity,
} from "lucide-react";
import { AtlasMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { ModelSwitcher } from "@/components/shell/model-switcher";
import { Markdown } from "@/components/markdown";
import { ReasoningBlock } from "@/components/reasoning-block";
import { ToolCall } from "@/components/tool-call";
import { ProviderBanner } from "@/components/provider-banner";
import {
  ArtifactPanel,
  extractArtifact,
  type Artifact,
} from "@/components/chat/artifact-panel";
import { SettingsDialog } from "@/components/chat/settings-dialog";
import { MemoryDialog } from "@/components/chat/memory-dialog";
import { ProjectsDialog } from "@/components/chat/projects-dialog";
import { Sources } from "@/components/chat/sources";
import { getModelById, modelAccess, routableModels } from "@/lib/catalog";
import { useUIStore } from "@/lib/store/ui-store";
import { useKeysStore } from "@/lib/store/keys-store";
import { useProviders } from "@/lib/hooks/use-providers";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { useChatStore } from "@/lib/store/chat-store";
import { useSettingsStore, buildSystemPrompt } from "@/lib/store/settings-store";
import { useMemoryStore } from "@/lib/store/memory-store";
import { useProjectsStore, projectContext } from "@/lib/store/projects-store";
import { recallMemories, extractMemory } from "@/lib/chat/memory";
import { sessionCostUsd, messageCostUsd, formatUsd } from "@/lib/chat/cost";
import { toMarkdown, toJSON, downloadText, slugify } from "@/lib/chat/export";
import { siblingsOf, childrenMap, ROOT } from "@/lib/chat/tree";
import { parseAttachment, attachmentsToPromptText } from "@/lib/chat/attachments";
import {
  uuid,
  type Attachment,
  type ChatMessage,
  type StoredToolCall,
  type WebSource,
} from "@/lib/chat/types";
import { useDictation, useTTS } from "@/lib/hooks/use-speech";
import { useAtlasEvent, announce } from "@/lib/atlas-events";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { cn, timeAgo } from "@/lib/utils";
import { buildEscalationPayload, stashEscalation } from "@/lib/chat/escalate";
import { measureHealth, shouldSuggestSummarize, buildContinuationSummary } from "@/lib/chat/health";
import { isEnabled } from "@/lib/store/flags-store";
import type { ReasoningEffort } from "@/lib/store/settings-store";

const STARTERS = [
  { title: "Explain a concept", prompt: "Explain how transformer attention works, intuitively, with a small analogy." },
  { title: "Build an artifact", prompt: "Create a single-file HTML page with an animated starfield on a dark background." },
  { title: "Compare approaches", prompt: "Compare RAG vs fine-tuning for a customer-support assistant. Be concise." },
  { title: "Write code", prompt: "Write a TypeScript debounce function with a leading-edge option and tests." },
];

type RouterMsg = { role: "system" | "user" | "assistant"; content: any };

function searchContextBlock(sources: WebSource[]): string {
  const body = sources
    .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.snippet}`)
    .join("\n\n");
  return (
    "Web search results for the user's latest message. Use them to answer with current " +
    "information and cite the ones you rely on inline as [1], [2], etc.\n\n" +
    body
  );
}

function toRouterMessages(
  msgs: ChatMessage[],
  modelId: string,
  system: string,
  searchSources?: WebSource[],
): RouterMsg[] {
  const model = getModelById(modelId);
  const vision = !!model?.modalities.includes("vision");
  const out: RouterMsg[] = [{ role: "system", content: system }];
  if (searchSources?.length)
    out.push({ role: "system", content: searchContextBlock(searchSources) });
  msgs.forEach((m, i) => {
    if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content });
      return;
    }
    const textual = m.attachments ? attachmentsToPromptText(m.attachments) : "";
    const baseText = [m.content, textual].filter(Boolean).join("\n\n");
    const images = (m.attachments ?? []).filter((a) => a.kind === "image" && a.dataUrl);
    const isLast = i === msgs.length - 1;
    if (vision && images.length && isLast) {
      out.push({
        role: "user",
        content: [
          { type: "text", text: baseText || "(see attached image)" },
          ...images.map((im) => ({ type: "image_url", image_url: { url: im.dataUrl } })),
        ],
      });
    } else {
      out.push({ role: "user", content: baseText });
    }
  });
  return out;
}

export function ChatClient({ initialModelId }: { initialModelId?: string }) {
  const providers = useProviders();
  const activeModelId = useUIStore((s) => s.activeModelId);
  const setActiveModel = useUIStore((s) => s.setActiveModel);
  const keyHeaders = useUserKeyHeaders();
  const hasKey = useKeysStore((s) => s.openrouterKey.length > 0);
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);

  const {
    conversations,
    activeId,
    messages,
    tree,
    init,
    select,
    newChat,
    ensureConversation,
    setProject,
    addMessage,
    patchMessage,
    persistMessage,
    selectSibling,
  } = useChatStore();

  const settings = useSettingsStore();
  const memItems = useMemoryStore((s) => s.items);
  const addMemory = useMemoryStore((s) => s.add);
  const projects = useProjectsStore((s) => s.projects);

  const tts = useTTS();

  const [input, setInput] = React.useState("");
  const [pending, setPending] = React.useState<Attachment[]>([]);
  const [parsing, setParsing] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [artifactOpen, setArtifactOpen] = React.useState(false);
  const [atBottom, setAtBottom] = React.useState(true);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [memoryOpen, setMemoryOpen] = React.useState(false);
  const [projectsOpen, setProjectsOpen] = React.useState(false);
  // Project for a not-yet-created chat; once a conversation exists, its own
  // projectId wins.
  const [pendingProjectId, setPendingProjectId] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    init();
  }, [init]);

  React.useEffect(() => {
    if (initialModelId && getModelById(initialModelId)) setActiveModel(initialModelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAtlasEvent("new", () => start());

  React.useEffect(() => {
    if (atBottom)
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, atBottom]);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const activeProjectId = activeConv?.projectId ?? pendingProjectId;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const artifactVersions = React.useMemo(() => {
    const out: Artifact[] = [];
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      const art = extractArtifact(m.content);
      if (art) out.push(art);
    }
    return out;
  }, [messages]);

  const sessionCost = React.useMemo(() => sessionCostUsd(messages), [messages]);

  // Sibling lookup for the whole thread, built once per render instead of once
  // per message. `childrenMap` sorts every node in the conversation, so calling
  // it inside the message loop made rendering O(N² log N).
  const childrenByParent = React.useMemo(() => childrenMap(tree.nodes), [tree.nodes]);

  // Handlers passed to the memoized MessageBubbles must keep a stable identity
  // or the memo never hits. They close over streaming state, settings and the
  // live tree, so rather than hand-maintaining dependency arrays (where a
  // missed dep silently freezes a stale closure), they read through a ref that
  // is refreshed on every render. Identity is permanently stable; the value
  // behind it is always current.
  const latest = React.useRef({ tree, regenerate, editUser, patchMessage, selectSibling });
  latest.current = { tree, regenerate, editUser, patchMessage, selectSibling };

  const handleSibling = React.useCallback((id: string, dir: -1 | 1) => {
    const sib = siblingsOf(latest.current.tree, id);
    const next = sib.index + dir;
    if (next >= 0 && next < sib.ids.length) latest.current.selectSibling(sib.ids[next]);
  }, []);
  const handlePin = React.useCallback((id: string, pinned: boolean) => {
    latest.current.patchMessage(id, { pinned: !pinned });
  }, []);
  const handleRegenerate = React.useCallback((id: string, modelId?: string) => {
    latest.current.regenerate(id, modelId);
  }, []);
  const handleEdit = React.useCallback((id: string, text: string) => {
    latest.current.editUser(id, text);
  }, []);
  const handleOpenArtifact = React.useCallback(() => setArtifactOpen(true), []);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }

  function jumpToLatest() {
    setAtBottom(true);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    setParsing(true);
    for (const f of files) {
      const att = await parseAttachment(f);
      setPending((p) => [...p, att]);
    }
    setParsing(false);
  }

  async function maybeSearch(text: string): Promise<WebSource[] | undefined> {
    if (!settings.webSearch || !text.trim()) return undefined;
    try {
      const res = await fetch("/api/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, count: 5 }),
      });
      const j = await res.json();
      return Array.isArray(j.sources) && j.sources.length ? (j.sources as WebSource[]) : undefined;
    } catch {
      return undefined;
    }
  }

  function assignProject(projectId: string | null) {
    if (activeId) setProject(activeId, projectId);
    else setPendingProjectId(projectId);
  }

  /**
   * Stream a completion into an existing assistant node. History, system
   * prompt, memory recall and search context are all derived from the current
   * active path, so this powers first-send, regenerate and edit-branch alike.
   */
  async function streamInto(asstId: string, modelId: string, searchSources?: WebSource[]) {
    const path = useChatStore.getState().messages;
    const history = path.filter((m) => m.id !== asstId);
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    const sources = searchSources ?? lastUser?.sources;

    const memories = settings.memory
      ? recallMemories(memItems, lastUser?.content ?? "", 4).map((m) => m.content)
      : [];
    const system = buildSystemPrompt({
      style: settings.style,
      aboutYou: settings.aboutYou,
      responseGuidance: settings.responseGuidance,
      displayName: settings.displayName,
      projectInstructions: activeProject ? projectContext(activeProject) : undefined,
      memories,
    });
    const routerMessages = toRouterMessages(history, modelId, system, sources);
    const effort = settings.reasoningEffort;
    const reasoningParam = effort !== "off" ? effort : undefined;

    setStreaming(true);
    setAtBottom(true);

    let acc = "";
    let reasoning = "";
    let errored = false;
    const tools: StoredToolCall[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      patchMessage(asstId, { content: acc, reasoning: reasoning || undefined });
    };
    const schedule = () => {
      if (flushTimer == null) flushTimer = setTimeout(flush, 48);
    };
    const clearFlush = () => {
      if (flushTimer != null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    };
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      for await (const ev of postSSE<any>(
        "/api/v1/router/chat",
        { modelId, messages: routerMessages, reasoningEffort: reasoningParam },
        ctrl.signal,
        keyHeaders,
      )) {
        if (ev.type === "delta") {
          acc += ev.text;
          schedule();
        } else if (ev.type === "reasoning") {
          reasoning += ev.text;
          schedule();
        } else if (ev.type === "tool_call") {
          tools.push({ id: ev.id, name: ev.name, arguments: ev.arguments });
          patchMessage(asstId, { toolCalls: [...tools] });
        } else if (ev.type === "usage") {
          patchMessage(asstId, {
            promptTokens: ev.promptTokens,
            completionTokens: ev.completionTokens,
          });
        } else if (ev.type === "error") {
          errored = true;
          clearFlush();
          if (ev.code === "key_required") setKeyModalOpen(true);
          patchMessage(asstId, { content: ev.message, error: true });
        }
      }
      clearFlush();
      if (!errored) {
        patchMessage(asstId, { content: acc, reasoning: reasoning || undefined });
        announce("Response complete");
        if (settings.voiceAutoRead && acc) tts.speak(asstId, acc);
      }
    } catch (e) {
      clearFlush();
      if ((e as Error).name === "AbortError") {
        if (acc) patchMessage(asstId, { content: acc, reasoning: reasoning || undefined });
      } else {
        const msg = e instanceof SSEHttpError ? e.message : (e as Error).message;
        if (e instanceof SSEHttpError && (e.code === "key_required" || e.status === 402))
          setKeyModalOpen(true);
        patchMessage(asstId, { content: acc || msg, error: !acc });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      await persistMessage(asstId);
    }
  }

  async function send(text: string, atts: Attachment[]) {
    if ((!text.trim() && atts.length === 0) || streaming) return;

    const target = getModelById(activeModelId);
    if (target && modelAccess(target) === "byok" && !hasKey && !providers.servePaid) {
      setKeyModalOpen(true);
      return;
    }

    setInput("");
    setPending([]);

    await ensureConversation(text || atts[0]?.name || "New chat", activeModelId, pendingProjectId);
    setPendingProjectId(null);

    // Auto-capture explicit "remember …" facts.
    if (settings.memory) {
      const fact = extractMemory(text);
      if (fact) addMemory(fact, "auto");
    }

    const sources = await maybeSearch(text);

    const userMsg: ChatMessage = {
      id: uuid(),
      role: "user",
      content: text,
      attachments: atts.length ? atts : undefined,
      sources,
      createdAt: Date.now(),
    };
    await addMessage(userMsg, true);

    const asstId = uuid();
    await addMessage(
      { id: asstId, role: "assistant", content: "", model: activeModelId, createdAt: Date.now() },
      false,
    );

    await streamInto(asstId, activeModelId, sources);
  }

  async function regenerate(asstId: string, modelId?: string) {
    if (streaming) return;
    const node = tree.nodes[asstId];
    if (!node) return;
    const model = modelId ?? node.model ?? activeModelId;
    const newId = uuid();
    await addMessage(
      {
        id: newId,
        role: "assistant",
        content: "",
        model,
        parentId: node.parentId ?? null,
        createdAt: Date.now(),
      },
      false,
    );
    await streamInto(newId, model);
  }

  async function editUser(userId: string, newText: string) {
    if (streaming || !newText.trim()) return;
    const u = tree.nodes[userId];
    if (!u) return;
    const sources = await maybeSearch(newText);
    const u2: ChatMessage = {
      id: uuid(),
      role: "user",
      content: newText,
      attachments: u.attachments,
      sources,
      parentId: u.parentId ?? null,
      createdAt: Date.now(),
    };
    await addMessage(u2, true);
    const asstId = uuid();
    await addMessage(
      { id: asstId, role: "assistant", content: "", model: activeModelId, parentId: u2.id, createdAt: Date.now() },
      false,
    );
    await streamInto(asstId, activeModelId, sources);
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  function start() {
    stop();
    tts.cancel();
    newChat();
    setArtifactOpen(false);
    setPending([]);
    setInput("");
    setPendingProjectId(null);
  }

  function exportChat(kind: "md" | "json") {
    if (!activeConv || messages.length === 0) return;
    const base = slugify(activeConv.title);
    if (kind === "md")
      downloadText(`${base}.md`, toMarkdown(activeConv, messages), "text/markdown");
    else downloadText(`${base}.json`, toJSON(activeConv, messages), "application/json");
  }

  function escalateToCode() {
    if (!isEnabled("chatEscalation")) return;
    const payload = buildEscalationPayload(messages, activeId ?? undefined);
    stashEscalation(payload);
    window.location.href = `/code?escalation=${payload.id}`;
  }

  function summarizeAndContinue() {
    const summary = buildContinuationSummary(messages);
    start();
    setTimeout(() => {
      setInput(`Continue our previous conversation. Here's the context:\n\n${summary}`);
    }, 50);
  }

  const model = getModelById(activeModelId);
  const empty = messages.length === 0;

  return (
    <div className="-mb-24 flex h-[calc(100dvh-4rem)] overflow-hidden lg:mb-0">
      {/* History rail */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface/40 lg:block">
        <HistoryRail
          activeId={activeId}
          onNew={start}
          onSelect={(id) => {
            stop();
            tts.cancel();
            setArtifactOpen(false);
            select(id);
          }}
          onOpenProjects={() => setProjectsOpen(true)}
          onOpenMemory={() => setMemoryOpen(true)}
        />
      </aside>

      {/* Thread column */}
      <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
        {/* Thread header */}
        <div className="flex h-12 items-center gap-2 border-b border-border px-3 sm:px-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="lg:hidden">
                <History className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xs p-0">
              <DialogHeader className="p-4 pb-0">
                <DialogTitle>Chats</DialogTitle>
              </DialogHeader>
              <div className="h-[60vh]">
                <HistoryRail
                  activeId={activeId}
                  onNew={start}
                  onSelect={(id) => {
                    stop();
                    tts.cancel();
                    setArtifactOpen(false);
                    select(id);
                  }}
                  onOpenProjects={() => setProjectsOpen(true)}
                  onOpenMemory={() => setMemoryOpen(true)}
                />
              </div>
            </DialogContent>
          </Dialog>

          <span className="truncate text-sm font-medium">
            {model?.name ?? "Select a model"}
          </span>
          {activeProject && (
            <button
              onClick={() => setProjectsOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2/50 px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground"
            >
              <FolderGit2 className="size-3 text-cyan" />
              <span className="max-w-[8rem] truncate">{activeProject.name}</span>
            </button>
          )}
          {sessionCost > 0 && (
            <span className="hidden text-2xs text-muted-foreground/70 sm:inline">
              {formatUsd(sessionCost)} session
            </span>
          )}
          {!empty && <TokenHealthBadge messages={messages} modelId={activeModelId} />}
          <div className="ml-auto flex items-center gap-1">
            {artifactVersions.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setArtifactOpen((v) => !v)}>
                <Code2 className="size-4" /> Artifact
              </Button>
            )}
            {!empty && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" title="Export">
                    <Download className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportChat("md")}>
                    <FileText className="size-4" /> Export Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportChat("json")}>
                    <Code2 className="size-4" /> Export JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              title="Personalize"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={start} title="New chat">
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
            {!providers.loading && !providers.any && (
              <div className="mx-auto max-w-3xl px-4 pt-5">
                <ProviderBanner />
              </div>
            )}

            {empty ? (
              <EmptyState onPick={(p) => send(p, [])} disabled={streaming} />
            ) : (
              <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
                {messages.map((m, i) => {
                  const sibIds = childrenByParent.get(m.parentId ?? ROOT);
                  return (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      modelName={model?.name ?? "Atlas"}
                      streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
                      siblingCount={sibIds?.length ?? 1}
                      siblingIndex={Math.max(0, sibIds?.indexOf(m.id) ?? 0)}
                      onSibling={handleSibling}
                      tts={tts}
                      canAct={!streaming}
                      onPin={handlePin}
                      onOpenArtifact={handleOpenArtifact}
                      onRegenerate={handleRegenerate}
                      onEdit={handleEdit}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <AnimatePresence>
            {!atBottom && !empty && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                onClick={jumpToLatest}
                className="absolute bottom-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface/90 px-3 py-1.5 text-xs shadow-lift backdrop-blur"
              >
                <ArrowDown className="size-3.5 text-cyan" /> Jump to latest
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Composer */}
        <Composer
          input={input}
          setInput={setInput}
          pending={pending}
          parsing={parsing}
          streaming={streaming}
          webSearch={settings.webSearch}
          memory={settings.memory}
          reasoningEffort={settings.reasoningEffort}
          onReasoningChange={(r) => settings.set({ reasoningEffort: r })}
          onToggleWeb={() => settings.toggle("webSearch")}
          onToggleMemory={() => settings.toggle("memory")}
          onOpenProjects={() => setProjectsOpen(true)}
          hasProject={!!activeProject}
          canEscalate={isEnabled("chatEscalation") && messages.length > 0}
          onEscalate={escalateToCode}
          onSummarize={shouldSuggestSummarize(measureHealth(messages, activeModelId)) ? summarizeAndContinue : undefined}
          onRemoveAttachment={(id) => setPending((p) => p.filter((a) => a.id !== id))}
          onPickFiles={() => fileRef.current?.click()}
          onFiles={handleFiles}
          onSend={() => send(input, pending)}
          onStop={stop}
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Artifact panel (desktop) */}
      <AnimatePresence>
        {artifactVersions.length > 0 && artifactOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 460, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="hidden shrink-0 overflow-hidden xl:block"
          >
            <div className="h-full w-[460px]">
              <ArtifactPanel
                versions={artifactVersions}
                onClose={() => setArtifactOpen(false)}
                onEdit={(instruction) =>
                  send(
                    `Update the artifact: ${instruction}. Return the full updated version in a single fenced code block.`,
                    [],
                  )
                }
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Artifact sheet (mobile/tablet) */}
      <AnimatePresence>
        {artifactVersions.length > 0 && artifactOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 xl:hidden"
          >
            <div
              className="absolute inset-0 bg-background/60 backdrop-blur-sm"
              onClick={() => setArtifactOpen(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute inset-x-0 bottom-0 top-12 overflow-hidden rounded-t-2xl"
            >
              <ArtifactPanel
                versions={artifactVersions}
                onClose={() => setArtifactOpen(false)}
                onEdit={(instruction) =>
                  send(
                    `Update the artifact: ${instruction}. Return the full updated version in a single fenced code block.`,
                    [],
                  )
                }
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <MemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} />
      <ProjectsDialog
        open={projectsOpen}
        onOpenChange={setProjectsOpen}
        activeProjectId={activeProjectId}
        onAssign={assignProject}
      />
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────
function HistoryRail({
  activeId,
  onNew,
  onSelect,
  onOpenProjects,
  onOpenMemory,
}: {
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onOpenProjects: () => void;
  onOpenMemory: () => void;
}) {
    const conversations = useChatStore((s) => s.conversations);
    const rename = useChatStore((s) => s.rename);
    const togglePin = useChatStore((s) => s.togglePin);
    const remove = useChatStore((s) => s.remove);
    const [q, setQ] = React.useState("");
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState("");

    const filtered = conversations.filter((c) =>
      c.title.toLowerCase().includes(q.toLowerCase()),
    );
    const pinned = filtered.filter((c) => c.pinned);
    const rest = filtered.filter((c) => !c.pinned);

    const groupEl = (list: typeof conversations, heading: string) =>
      list.length > 0 && (
        <div>
          <p className="px-2 py-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            {heading}
          </p>
          {list.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group/item flex items-center gap-1 rounded-lg pr-1 transition-colors",
                c.id === activeId ? "bg-surface-2/80" : "hover:bg-surface-2/50",
              )}
            >
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    rename(c.id, draft);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      rename(c.id, draft);
                      setEditingId(null);
                    } else if (e.key === "Escape") setEditingId(null);
                  }}
                  className="m-1 h-7 flex-1 rounded-md border border-cyan/40 bg-surface-2 px-2 text-sm outline-none"
                />
              ) : (
                <button
                  onClick={() => onSelect(c.id)}
                  className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-2 text-left text-sm text-muted-foreground group-hover/item:text-foreground"
                >
                  <MessageSquare className="mt-0.5 size-4 shrink-0 opacity-70" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1">
                      {c.pinned && <Pin className="size-3 shrink-0 text-amber" />}
                      <span className="truncate">{c.title}</span>
                    </span>
                    <span className="text-2xs text-muted-foreground/70">
                      {timeAgo(c.updatedAt)}
                    </span>
                  </span>
                </button>
              )}
              <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/item:opacity-100">
                <RailAction title={c.pinned ? "Unpin" : "Pin"} onClick={() => togglePin(c.id)}>
                  <Pin className={cn("size-3.5", c.pinned && "text-amber")} />
                </RailAction>
                <RailAction
                  title="Rename"
                  onClick={() => {
                    setEditingId(c.id);
                    setDraft(c.title);
                  }}
                >
                  <Pencil className="size-3.5" />
                </RailAction>
                <RailAction title="Delete" onClick={() => remove(c.id)}>
                  <Trash2 className="size-3.5" />
                </RailAction>
              </div>
            </div>
          ))}
        </div>
      );

    return (
      <div className="flex h-full flex-col">
        <div className="space-y-2 p-3">
          <Button variant="secondary" className="w-full justify-start" onClick={onNew}>
            <Plus className="size-4" /> New chat
          </Button>
          <div className="flex gap-2">
            <button
              onClick={onOpenProjects}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:border-cyan/40 hover:text-foreground"
            >
              <FolderGit2 className="size-3.5 text-cyan" /> Projects
            </button>
            <button
              onClick={onOpenMemory}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:border-cyan/40 hover:text-foreground"
            >
              <Brain className="size-3.5 text-violet" /> Memory
            </button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats…"
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No conversations yet.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No matches.
            </p>
          ) : (
            <>
              {groupEl(pinned, "Pinned")}
              {groupEl(rest, "Recent")}
            </>
          )}
        </div>
      </div>
    );
  }

function RailAction({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-surface-3 hover:text-foreground"
    >
      {children}
    </button>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

// Memoized: while a response streams, the store patches only the last message,
// so every other bubble receives an identical `message` reference and skips
// re-rendering entirely. All callbacks are id-taking and stable by contract —
// keep them that way, or this memo silently stops working.
const MessageBubble = React.memo(function MessageBubble({
  message,
  modelName,
  streaming,
  siblingCount,
  siblingIndex,
  onSibling,
  tts,
  canAct,
  onPin,
  onOpenArtifact,
  onRegenerate,
  onEdit,
}: {
  message: ChatMessage;
  modelName: string;
  streaming: boolean;
  siblingCount: number;
  siblingIndex: number;
  onSibling: (id: string, dir: -1 | 1) => void;
  tts: ReturnType<typeof useTTS>;
  canAct: boolean;
  onPin: (id: string, pinned: boolean) => void;
  onOpenArtifact: () => void;
  onRegenerate: (id: string, modelId?: string) => void;
  onEdit: (id: string, text: string) => void;
}) {
  const isUser = message.role === "user";
  const hasArtifact = !isUser && !!extractArtifact(message.content);
  const [copied, setCopied] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(message.content);

  const cost =
    !isUser && message.completionTokens != null
      ? message.costUsd ?? messageCostUsd(message.model, message.promptTokens, message.completionTokens)
      : 0;

  return (
    <div className={cn("group flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-xl",
          isUser ? "bg-surface-3 text-muted-foreground" : "bg-gradient-primary text-primary-foreground",
        )}
      >
        {isUser ? <User className="size-4" /> : <AtlasMark size={18} />}
      </div>
      <div className={cn("min-w-0 max-w-[85%]", isUser && "flex flex-col items-end")}>
        <div className="mb-1 flex items-center gap-2 text-2xs text-muted-foreground">
          <span>{isUser ? "You" : message.model ? getModelById(message.model)?.name ?? modelName : modelName}</span>
          {message.pinned && <Pin className="size-3 text-amber" />}
          {siblingCount > 1 && (
            <span className="inline-flex items-center gap-0.5 rounded-md border border-border px-1 py-0.5">
              <button
                onClick={() => onSibling(message.id, -1)}
                disabled={siblingIndex === 0}
                className="disabled:opacity-30"
                title="Previous version"
              >
                <ChevronLeft className="size-3" />
              </button>
              <span className="tabular-nums">
                {siblingIndex + 1}/{siblingCount}
              </span>
              <button
                onClick={() => onSibling(message.id, 1)}
                disabled={siblingIndex === siblingCount - 1}
                className="disabled:opacity-30"
                title="Next version"
              >
                <ChevronRight className="size-3" />
              </button>
            </span>
          )}
        </div>

        {/* Sources (web search) */}
        {message.sources && message.sources.length > 0 && <Sources sources={message.sources} />}

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className={cn("mb-1.5 flex flex-wrap gap-1.5", isUser && "justify-end")}>
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} att={a} />
            ))}
          </div>
        )}

        {/* Reasoning (assistant) */}
        {!isUser && (message.reasoning || (streaming && !message.content)) && (
          <ReasoningBlock text={message.reasoning ?? ""} streaming={streaming && !message.content} />
        )}

        {/* Tool calls */}
        {!isUser && message.toolCalls?.map((t) => <ToolCall key={t.id} call={t} />)}

        {/* Body / editor */}
        {isUser && editing ? (
          <div className="w-full min-w-[16rem]">
            <textarea
              autoFocus
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  setEditing(false);
                  onEdit(message.id, editText);
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setEditText(message.content);
                }
              }}
              rows={3}
              className="w-full resize-none rounded-2xl border border-cyan/40 bg-surface-2/60 px-4 py-2.5 text-[15px] outline-none"
            />
            <div className="mt-1 flex justify-end gap-2 text-2xs">
              <button
                onClick={() => {
                  setEditing(false);
                  setEditText(message.content);
                }}
                className="rounded-md px-2 py-1 text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  onEdit(message.id, editText);
                }}
                className="rounded-md bg-gradient-primary px-2.5 py-1 text-primary-foreground"
              >
                Save &amp; submit
              </button>
            </div>
          </div>
        ) : (
          (message.content || isUser || !streaming || message.error) && (
            <div
              className={cn(
                "rounded-2xl px-4 py-2.5 text-[15px]",
                isUser
                  ? "bg-surface-3 text-foreground"
                  : message.error
                    ? "border border-danger/30 bg-danger/10 text-danger"
                    : "border border-border bg-surface/60",
              )}
            >
              {message.error ? (
                <span className="flex items-center gap-2 text-sm">
                  <AlertCircle className="size-4" /> {message.content}
                </span>
              ) : isUser ? (
                <p className="whitespace-pre-wrap">{message.content || "​"}</p>
              ) : message.content ? (
                <Markdown streaming={streaming}>{message.content}</Markdown>
              ) : (
                <Dots />
              )}
              {streaming && message.content && (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-caret-blink bg-cyan align-text-bottom" />
              )}
            </div>
          )
        )}

        {/* Usage + cost */}
        {!isUser && message.completionTokens != null && !message.error && (
          <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground/70">
            <span>
              {message.promptTokens != null && `${message.promptTokens} in · `}
              {message.completionTokens} out
            </span>
            {cost > 0 && <span>· {formatUsd(cost)}</span>}
          </div>
        )}

        {/* Actions */}
        {!editing && (
          <div
            className={cn(
              "mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100",
              isUser && "flex-row-reverse",
            )}
          >
            {isUser ? (
              canAct && (
                <ActionBtn onClick={() => { setEditText(message.content); setEditing(true); }}>
                  <Pencil className="size-3.5" /> Edit
                </ActionBtn>
              )
            ) : (
              message.content &&
              !message.error && (
                <>
                  {hasArtifact && (
                    <ActionBtn onClick={onOpenArtifact} className="text-cyan">
                      <Code2 className="size-3.5" /> Open artifact
                    </ActionBtn>
                  )}
                  <ActionBtn
                    onClick={() => {
                      navigator.clipboard.writeText(message.content);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </ActionBtn>
                  {tts.supported && (
                    <ActionBtn onClick={() => tts.toggle(message.id, message.content)}>
                      {tts.speakingId === message.id ? (
                        <><VolumeX className="size-3.5" /> Stop</>
                      ) : (
                        <><Volume2 className="size-3.5" /> Read</>
                      )}
                    </ActionBtn>
                  )}
                  {canAct && (
                    <RegenControl
                      onRegenerate={(modelId) => onRegenerate(message.id, modelId)}
                    />
                  )}
                  <ActionBtn onClick={() => onPin(message.id, !!message.pinned)}>
                    <Pin className="size-3.5" /> Pin
                  </ActionBtn>
                  {isEnabled("chatEscalation") && hasArtifact && (
                    <ActionBtn
                      onClick={() => {
                        const payload = buildEscalationPayload(
                          useChatStore.getState().messages,
                          useChatStore.getState().activeId ?? undefined,
                        );
                        stashEscalation(payload);
                        window.location.href = `/code?escalation=${payload.id}`;
                      }}
                      className="text-violet"
                    >
                      <ArrowRightFromLine className="size-3.5" /> Code
                    </ActionBtn>
                  )}
                </>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/** Regenerate button with an optional model-swap picker. */
function RegenControl({ onRegenerate }: { onRegenerate: (modelId?: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const models = React.useMemo(() => routableModels(), []);
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md hover:bg-surface-2">
      <button
        onClick={() => onRegenerate()}
        className="inline-flex items-center gap-1 px-1.5 py-1 text-2xs text-muted-foreground hover:text-foreground"
        title="Regenerate"
      >
        <RefreshCw className="size-3.5" /> Retry
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="grid h-full place-items-center px-1 text-muted-foreground hover:text-foreground"
            title="Regenerate with another model"
          >
            <ChevronsUpDown className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Retry with model…" />
            <CommandList>
              <CommandEmpty>No models.</CommandEmpty>
              <CommandGroup>
                {models.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.name} ${m.provider}`}
                    onSelect={() => {
                      setOpen(false);
                      onRegenerate(m.id);
                    }}
                  >
                    <span className="truncate">{m.name}</span>
                    <span className="ml-auto text-2xs text-muted-foreground">{m.provider}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function AttachmentChip({ att }: { att: Attachment }) {
  const Icon =
    att.kind === "image"
      ? ImageIcon
      : att.kind === "csv" || att.kind === "xlsx"
        ? Table2
        : FileText;
  if (att.kind === "image" && att.dataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={att.dataUrl}
        alt={att.name}
        className="size-16 rounded-lg border border-border object-cover"
      />
    );
  }
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-2 py-1 text-2xs",
        att.failed && "border-danger/40 text-danger",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-cyan" />
      <span className="max-w-[10rem] truncate">{att.name}</span>
    </div>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────────

function Composer({
  input,
  setInput,
  pending,
  parsing,
  streaming,
  webSearch,
  memory,
  reasoningEffort,
  onReasoningChange,
  onToggleWeb,
  onToggleMemory,
  onOpenProjects,
  hasProject,
  canEscalate,
  onEscalate,
  onSummarize,
  onRemoveAttachment,
  onPickFiles,
  onFiles,
  onSend,
  onStop,
}: {
  input: string;
  setInput: (v: string) => void;
  pending: Attachment[];
  parsing: boolean;
  streaming: boolean;
  webSearch: boolean;
  memory: boolean;
  reasoningEffort: ReasoningEffort;
  onReasoningChange: (r: ReasoningEffort) => void;
  onToggleWeb: () => void;
  onToggleMemory: () => void;
  onOpenProjects: () => void;
  hasProject: boolean;
  canEscalate?: boolean;
  onEscalate?: () => void;
  onSummarize?: () => void;
  onRemoveAttachment: (id: string) => void;
  onPickFiles: () => void;
  onFiles: (files: FileList | File[]) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation((text) =>
    setInput((input ? input + " " : "") + text.trim()),
  );

  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  const canSend = (input.trim().length > 0 || pending.length > 0) && !parsing;

  return (
    <div className="border-t border-border bg-background/80 px-3 py-3 backdrop-blur-xl sm:px-4">
      <div className="mx-auto max-w-3xl">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
          }}
          className={cn(
            "rounded-2xl border bg-surface/60 p-2.5 shadow-glow transition-colors focus-within:border-cyan/40",
            dragOver ? "border-cyan/60 bg-cyan/5" : "border-border",
          )}
        >
          {(pending.length > 0 || parsing) && (
            <div className="mb-2 flex flex-wrap gap-1.5 px-1">
              {pending.map((a) => (
                <div
                  key={a.id}
                  className={cn(
                    "group/att inline-flex items-center gap-1.5 rounded-lg border bg-surface-2/60 px-2 py-1 text-2xs",
                    a.failed ? "border-danger/40 text-danger" : "border-border",
                  )}
                >
                  <span className="max-w-[10rem] truncate">{a.name}</span>
                  <button onClick={() => onRemoveAttachment(a.id)}>
                    <X className="size-3 opacity-60 group-hover/att:opacity-100" />
                  </button>
                </div>
              ))}
              {parsing && (
                <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> parsing…
                </span>
              )}
            </div>
          )}

          <textarea
            ref={taRef}
            value={input + (dictation.listening && dictation.interim ? ` ${dictation.interim}` : "")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend && !streaming) onSend();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                onFiles(files);
              }
            }}
            rows={1}
            placeholder="Message Atlas…  (Enter to send, Shift+Enter for newline)"
            className="max-h-52 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-muted-foreground/60"
          />
          <div className="flex items-center gap-1.5">
            <ModelSwitcher />
            <ComposerToggle active={webSearch} onClick={onToggleWeb} title="Web search — cite live results">
              <Globe className="size-4" />
            </ComposerToggle>
            <ComposerToggle active={memory} onClick={onToggleMemory} title="Memory — recall & save facts across chats">
              <Brain className="size-4" />
            </ComposerToggle>
            <ComposerToggle active={hasProject} onClick={onOpenProjects} title="Project knowledge">
              <FolderGit2 className="size-4" />
            </ComposerToggle>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onPickFiles}
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <Paperclip className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Attach files (images, PDF, docx, csv, xlsx, code)</TooltipContent>
            </Tooltip>
            {dictation.supported && (
              <ComposerToggle
                active={dictation.listening}
                onClick={dictation.toggle}
                title={dictation.listening ? "Stop dictation" : "Dictate"}
                pulse={dictation.listening}
              >
                <Mic className="size-4" />
              </ComposerToggle>
            )}
            <ReasoningSelector value={reasoningEffort} onChange={onReasoningChange} />
            {canEscalate && onEscalate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onEscalate}
                    className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-violet/15 hover:text-violet"
                  >
                    <ArrowRightFromLine className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Continue in Atlas Code</TooltipContent>
              </Tooltip>
            )}
            {onSummarize && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onSummarize}
                    className="grid size-9 place-items-center rounded-lg text-amber hover:bg-amber/15"
                  >
                    <Activity className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Summarize & continue (context getting long)</TooltipContent>
              </Tooltip>
            )}

            <div className="ml-auto">
              {streaming ? (
                <Button variant="danger" size="icon" onClick={onStop}>
                  <Square className="size-4" />
                </Button>
              ) : (
                <Button variant="primary" size="icon" onClick={onSend} disabled={!canSend}>
                  <Send className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposerToggle({
  children,
  active,
  onClick,
  title,
  pulse,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
  pulse?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "grid size-9 place-items-center rounded-lg transition-colors",
            active
              ? "bg-cyan/15 text-cyan"
              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            pulse && "animate-pulse",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

// ── Reasoning effort selector ─────────────────────────────────────────────────

function ReasoningSelector({
  value,
  onChange,
}: {
  value: ReasoningEffort;
  onChange: (r: ReasoningEffort) => void;
}) {
  const levels: ReasoningEffort[] = ["off", "low", "medium", "high"];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "grid size-9 place-items-center rounded-lg transition-colors",
            value !== "off"
              ? "bg-amber/15 text-amber"
              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
          )}
          title={`Reasoning: ${value}`}
        >
          <Zap className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <p className="mb-1.5 text-xs font-medium">Reasoning effort</p>
        <div className="grid grid-cols-4 gap-0.5 rounded-lg bg-surface-2 p-0.5 text-center text-xs">
          {levels.map((r) => (
            <button
              key={r}
              onClick={() => onChange(r)}
              className={cn(
                "rounded-md py-1.5 capitalize transition-colors",
                value === r ? "bg-surface shadow-sm font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-2xs text-muted-foreground">
          Higher effort = deeper reasoning, more tokens. Works with Claude, o1, Gemini Thinking.
        </p>
      </PopoverContent>
    </Popover>
  );
}

// ── Token health badge ────────────────────────────────────────────────────────

function TokenHealthBadge({ messages, modelId }: { messages: ChatMessage[]; modelId: string }) {
  const health = React.useMemo(() => measureHealth(messages, modelId), [messages, modelId]);
  if (health.status === "ok") return null;
  const pct = Math.round(health.usage * 100);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "hidden items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs sm:inline-flex",
            health.status === "critical"
              ? "border-danger/40 text-danger"
              : "border-amber/40 text-amber",
          )}
        >
          <Activity className="size-3" />
          {pct}%
        </span>
      </TooltipTrigger>
      <TooltipContent>
        ~{(health.estimatedTokens / 1000).toFixed(0)}k / {(health.contextWindow / 1000).toFixed(0)}k tokens used.
        {health.status === "critical" && " Consider summarizing."}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (p: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-16 text-center">
      <div className="relative mb-5">
        <div className="absolute -inset-5 rounded-full bg-gradient-primary opacity-20 blur-2xl" />
        <AtlasMark size={56} className="relative" />
      </div>
      <h2 className="font-display text-2xl font-semibold tracking-tight">How can Atlas help?</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Chat over any model with artifacts, attachments, memory, web search, and branching.
      </p>
      <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
        {STARTERS.map((s, i) => (
          <motion.button
            key={s.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            disabled={disabled}
            onClick={() => onPick(s.prompt)}
            className="group rounded-xl border border-border bg-surface/50 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-cyan/40 hover:shadow-lift"
          >
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-cyan" /> {s.title}
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">{s.prompt}</p>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse-dot rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}
