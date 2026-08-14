"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  FileText,
  Code2,
  History,
  X,
  ArrowDown,
  FolderGit2,
  Settings2,
  Package,
  Download,
  Activity,
  PanelLeft,
  PanelLeftClose,
  Layers,
  AlertCircle,
  Hammer,
  MessageSquare,
  Table2,
  Telescope,
} from "lucide-react";
import { AtlasMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ResizeHandle } from "@/components/ui/resizable";
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
import { Markdown } from "@/components/markdown";
import { ProviderBanner } from "@/components/provider-banner";
import {
  extractArtifact,
  type Artifact,
  type ArtifactType,
  type ArtifactFile,
} from "@/components/chat/artifact-panel";

/** A run that has not started. Shared by the initial state and every reset. */
const EMPTY_RUN_METERS = {
  rounds: 0,
  maxRounds: 0,
  spentUsd: 0,
  maxUsd: 0,
  /** Characters on the wire this round, after trimming. 0 between turns. */
  contextChars: 0,
  summary: undefined as string | undefined,
};

/** One file's persisted history, plus the record that owns its storage namespace. */
interface StoredFile {
  path: string;
  record: ArtifactRecord;
  versions: Artifact[];
}
import { SettingsDialog } from "@/components/chat/settings-dialog";
import { MemoryDialog } from "@/components/chat/memory-dialog";
import { ProjectsDialog } from "@/components/chat/projects-dialog";
import { HistoryRail } from "@/components/chat/history-rail";
import { MessageBubble } from "@/components/chat/message-bubble";
import { Composer } from "@/components/chat/composer";
import { getModelById, modelAccess } from "@/lib/catalog";
import type { CatalogModel } from "@/lib/catalog/types";
import { useUIStore } from "@/lib/store/ui-store";
import { useKeysStore } from "@/lib/store/keys-store";
import { useToolSupportStore } from "@/lib/store/tool-support-store";
import { shouldOfferTools, toolSupportFor, TOOL_DOWNGRADE_NOTE } from "@/lib/chat/tool-support";
import { useProviders } from "@/lib/hooks/use-providers";
import { useUserKeyHeaders } from "@/lib/hooks/use-user-key-headers";
import { useChatStore } from "@/lib/store/chat-store";
import { useSettingsStore, buildSystemPrompt } from "@/lib/store/settings-store";
import { useMemoryStore } from "@/lib/store/memory-store";
import { useProjectsStore } from "@/lib/store/projects-store";
import { useIncognitoStore } from "@/lib/store/incognito-store";
import { recallMemories, extractMemory } from "@/lib/chat/memory";
import { memoryDirectoryBlock } from "@/lib/chat/memory-fs";
import { listMemoryFiles } from "@/lib/chat/memory-repo";
import { indexConversation } from "@/lib/chat/chat-index";
import { listEnabledSkills } from "@/lib/skills/registry";
import { skillsIndexBlock } from "@/lib/skills/disclosure";
import { SkillsDialog } from "@/components/chat/skills-dialog";
import { ChatRailMount } from "@/components/chat/chat-rail-mount";
import {
  autoOpen,
  autoTab,
  railShown as computeRailShown,
  type OpenReason,
  type RailTab,
} from "@/lib/chat/rail-state";
import { summarizeRun } from "@/lib/chat/run-model";
import { ConnectorsDialog } from "@/components/chat/connectors-dialog";
import { ApprovalDialog } from "@/components/chat/approval-dialog";
import { listEnabledConnectors, updateConnector, type Connector } from "@/lib/mcp/registry";
import { connectorToolDefs, connectorsIndexBlock, runMcpTool } from "@/lib/mcp/bridge";
import { callConnectorTool } from "@/lib/mcp/client";
import { setRule, type ApprovalRule, type PendingApproval } from "@/lib/mcp/approval";
import { runResearch, describeRun, type RoundReport } from "@/lib/research/run";
import { localPlanner } from "@/lib/research/planner";
import { reconcileCitations, groundingWarning } from "@/lib/research/citations";
import { ResearchProgress } from "@/components/chat/research-progress";
import { PlanPanel } from "@/components/chat/plan-panel";
import { PluginsDialog } from "@/components/chat/plugins-dialog";
import { GithubDialog } from "@/components/chat/github-dialog";
import {
  abortPlan,
  approvePlan,
  createPlan,
  declinedToPlan,
  editStep,
  parsePlan,
  planPrompt,
  rejectPlan,
  removeStep,
  shouldPlan,
  stepPrompt,
  isFinalStep,
  type ChatPlan,
} from "@/lib/agent/plan";
import { runPlanSteps } from "@/lib/agent/run";
import { resolveProjectContext } from "@/lib/chat/rag";
import { lexicalEmbedder } from "@/lib/chat/embed";
import { executeTool, toolDefsFor } from "@/lib/chat/tools";
import {
  DEFAULT_PATH,
  listArtifactsForConversation,
  listVersions,
  pathOf,
  recordVersion,
  renameArtifact,
  revertToVersion,
  softDeleteArtifact,
  type ArtifactRecord,
} from "@/lib/chat/artifact-repo";
import { formatArtifactErrors } from "@/lib/chat/artifact-bridge";
import { runToolLoop, type LoopMessage, type WireEvent } from "@/lib/chat/tool-loop";
import { outputBudget, RESUME_INSTRUCTION, shouldContinue, stitch } from "@/lib/chat/continuation";
import {
  filesFromProse,
  proseFallbackNote,
  PROSE_FALLBACK_INSTRUCTION,
  shouldFallBackToProse,
  type ProseFile,
} from "@/lib/chat/prose-fallback";
import { buildWorkspaceContext } from "@/lib/chat/workspace/context";
import { workspaceSnapshot } from "@/lib/chat/workspace/repo";
import {
  bindWorkspace,
  toRelativePath,
  toWorkspacePath,
  type BuildStores,
} from "@/lib/chat/workspace/fs";
import { EMPTY_SNAPSHOT, type WorkspaceSnapshot } from "@/lib/chat/workspace/types";
import { entryPathOf, mirrorInputs } from "@/lib/chat/workspace/mirror";
import {
  extractArtifacts,
  extractArtifactMatches,
  kindAndLangForPath,
} from "@/lib/chat/artifact-extract";
import { sessionCostUsd, formatUsd, messageCostUsd } from "@/lib/chat/cost";
import {
  BuildBudget,
  limitsFor,
  maxMsFor,
  REPAIR_LIMITS,
  roundsFor,
  type StopReason,
} from "@/lib/chat/build-budget";
import { resumeInstruction, shouldAutoResume } from "@/lib/chat/resume";
import { createExecRuntime } from "@/lib/chat/exec/runtime";
import { listBlobs, mimeForPath, writeBlob, type BlobInfo } from "@/lib/chat/files/blob-repo";
import { callSignature, classifyRound } from "@/lib/chat/progress";
import { trimPolicyFor, trimToolTranscript } from "@/lib/chat/transcript-trim";
import { toRouterMessages, type RouterMsg } from "@/lib/chat/request";
import { ACTIONS_BUDGET } from "@/lib/chat/turn-actions";
import { detectBuildIntent, resolveAgentic } from "@/lib/chat/agentic";
import { AutoBuildDialog } from "@/components/chat/auto-build-dialog";
import { verifyEntryOf, type VerifyTarget } from "@/lib/chat/artifact-doc";
import { verifyArtifactInBrowser } from "@/lib/chat/artifact-verify-browser";
import { runArtifactRepair } from "@/lib/chat/artifact-repair-run";
import {
  describeGiveUp,
  repairLimitsFor,
  type RepairState,
} from "@/lib/chat/artifact-repair";
import { toMarkdown, toJSON, downloadText, slugify } from "@/lib/chat/export";
import { siblingsOf, childrenMap, ROOT } from "@/lib/chat/tree";
import {
  admitFiles,
  attachmentsToPromptText,
  parseAttachment,
  rejectionAttachment,
} from "@/lib/chat/attachments";
import {
  uuid,
  type Attachment,
  type ChatMessage,
  type StoredToolCall,
  type WebSource,
} from "@/lib/chat/types";
import { useTTS } from "@/lib/hooks/use-speech";
import { useMediaQueryLayout } from "@/lib/hooks/use-media-query";
import { useResizableSurface, type PanelSpec } from "@/lib/hooks/use-panel-resize";
import { useLayoutStore } from "@/lib/store/layout-store";
import {
  CHAT_ARTIFACT,
  CHAT_CENTER_MIN,
  CHAT_HISTORY,
  SHEET_MIN,
  SHEET_SNAPS,
  snapFraction,
} from "@/lib/panels";
import { useAtlasEvent, announce } from "@/lib/atlas-events";
import { postSSE, SSEHttpError } from "@/lib/sse-client";
import { clamp, cn } from "@/lib/utils";
import { buildEscalationPayload, stashEscalation } from "@/lib/chat/escalate";
import { measureHealth, shouldSuggestSummarize, type ConversationHealth } from "@/lib/chat/health";
import {
  ancestorsOf,
  applyFold,
  hasFoldedContext,
  keepRecentFor,
  planCompaction,
  shouldAutoCompact,
  type FoldSummary,
} from "@/lib/chat/compact";
import { loadFoldSummary, saveFoldSummary } from "@/lib/chat/fold-repo";
import { runFoldSummary } from "@/lib/chat/summarize-run";
import { indexFoldedTurns } from "@/lib/chat/recall";
import {
  encodeSubagentProgress,
  isSubagentTool,
  runSubagents,
  subagentPrompt,
  SUBAGENT_LIMITS,
  type SubagentOutcome,
  type SubagentTask,
  type SubagentTurnState,
} from "@/lib/chat/subagent";
import { isEnabled } from "@/lib/store/flags-store";
import type { ReasoningEffort } from "@/lib/store/settings-store";

/**
 * What "Edit this artifact" sends.
 *
 * It asks for a patch rather than a rewrite. A landing page is hundreds of
 * lines; re-emitting all of them to move a heading is slow, runs into the same
 * output limit that truncates pages in the first place, and gives the model that
 * many chances to change something it was not asked to.
 */
/**
 * Images a model returned, as attachments on its own message.
 *
 * Deterministic ids, derived from the position rather than a UUID: this runs on
 * every streamed image event, and a fresh id each time would remount the `<img>`
 * and make the picture flicker as later ones arrive.
 */
function toGeneratedAttachments(images: { url: string; mime?: string }[]): Attachment[] {
  return images.map((img, i) => ({
    id: `gen-${i}`,
    name: `image-${i + 1}.${(img.mime?.split("/")[1] ?? "png").replace("+xml", "")}`,
    kind: "image" as const,
    mime: img.mime || "image/png",
    // A data URL is ~4/3 of the bytes it carries; a remote URL has no size we
    // can know without fetching it, and fetching it is what §1.4 rules out.
    size: img.url.startsWith("data:") ? Math.floor((img.url.length * 3) / 4) : 0,
    dataUrl: img.url,
    generated: true,
  }));
}

const editArtifactPrompt = (instruction: string) =>
  `Update the artifact: ${instruction}. Use the \`artifact\` tool with \`update\` to patch ` +
  `just the part that changes; only fall back to \`rewrite\` if the change is too broad to patch. ` +
  `If the build has several files, \`list\` them first and give \`path\` so you patch the right one.`;

// The round cap, and every other per-turn limit, now lives in
// `lib/chat/build-budget.ts` — build mode needs 20 rounds where ordinary chat
// needs 4, and a single constant here could not express both. `CHAT_LIMITS`
// holds exactly the numbers this constant used to.
//
// `toRouterMessages`, `searchContextBlock` and `RouterMsg` moved to
// `lib/chat/request.ts`. They are the request, and the context meter has to
// measure the request rather than re-derive an estimate of it — which is how the
// meter came to count neither the search block nor the tool transcript.

/** Build this turn's wire messages. One helper, so the meter can call it too. */
function buildRequest(
  msgs: ChatMessage[],
  modelId: string,
  system: string,
  searchSources?: WebSource[],
): RouterMsg[] {
  return toRouterMessages(msgs, {
    system,
    vision: !!getModelById(modelId)?.modalities.includes("vision"),
    searchSources,
    actions: isEnabled("turnActions") ? ACTIONS_BUDGET : false,
  });
}

export function ChatClient({ initialModelId }: { initialModelId?: string }) {
  const providers = useProviders();
  const activeModelId = useUIStore((s) => s.activeModelId);
  const setActiveModel = useUIStore((s) => s.setActiveModel);
  const keyHeaders = useUserKeyHeaders();
  const hasKey = useKeysStore((s) => s.keyPresent);
  const setKeyModalOpen = useKeysStore((s) => s.setKeyModalOpen);
  const searchKey = useKeysStore((s) => s.searchKey);
  const githubKey = useKeysStore((s) => s.githubKey);
  const toolNegatives = useToolSupportStore((s) => s.negatives);
  const recordToolsUnsupported = useToolSupportStore((s) => s.recordToolsUnsupported);

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
    foldMessages,
    setPinned,
    agenticOverrides,
    setAgenticOverride,
  } = useChatStore();

  const settings = useSettingsStore();
  const memItems = useMemoryStore((s) => s.items);
  const memorySummary = useMemoryStore((s) => s.summary);
  const addMemory = useMemoryStore((s) => s.add);
  const projects = useProjectsStore((s) => s.projects);
  const incognito = useIncognitoStore((s) => s.active);
  const toggleIncognito = useIncognitoStore((s) => s.toggle);

  const tts = useTTS();

  const [input, setInput] = React.useState("");
  const [pending, setPending] = React.useState<Attachment[]>([]);
  const [parsing, setParsing] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [artifactOpen, setArtifactOpen] = React.useState(false);
  // Persisted artifact for this conversation. Its id namespaces window.storage,
  // so it must be resolved before the frame can serve storage calls.
  const [artifactRecord, setArtifactRecord] = React.useState<ArtifactRecord | null>(null);
  // Version history read back from IndexedDB, now grouped by file. The panel
  // renders from this rather than from message text, because the `artifact`
  // tool can produce a version by patching — and a patch never appears in the
  // transcript.
  const [storedFiles, setStoredFiles] = React.useState<StoredFile[]>([]);
  /** Which file the panel is showing. Null follows the most recent. */
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  // Bumped when a tool writes a version, to re-read the history above.
  const [artifactTick, setArtifactTick] = React.useState(0);
  // The same trick for the build workspace: a `workspace` or `tasks` call
  // changes storage without changing any message, so nothing else would tell
  // the panel to re-read.
  const [workspaceTick, setWorkspaceTick] = React.useState(0);
  const [workspaceSnap, setWorkspaceSnap] = React.useState<WorkspaceSnapshot>(EMPTY_SNAPSHOT);
  // Same trick again for generated binaries: `run_python` writes them straight to
  // IndexedDB, so no message changes and nothing else would tell the UI to look.
  const [blobTick, setBlobTick] = React.useState(0);
  /**
   * Live output from tools that stream, keyed by tool-call id.
   *
   * Kept out of the message so a half-written traceback never becomes part of
   * the transcript — the tool's own `result` is the durable record. This is the
   * terminal you watch while it runs.
   */
  /**
   * The two numbers that make an agent's spending legible, plus the clock.
   *
   * Read from the live `BuildBudget` rather than recomputed: the budget is what
   * actually stops the run, so a meter derived from anything else could show the
   * user a different figure from the one being enforced.
   */
  const [runMeters, setRunMeters] = React.useState<{
    rounds: number;
    maxRounds: number;
    spentUsd: number;
    maxUsd: number;
    contextChars: number;
    summary?: string;
  }>(EMPTY_RUN_METERS);

  /**
   * The clock, deliberately separate from the meters.
   *
   * It ticks every second and the meters change a handful of times a turn. Held
   * in one object, the tick alone rebuilt every consumer of the meters once a
   * second — including the whole rail. Only the header line reads this.
   */
  const [runClock, setRunClock] = React.useState({ startedAt: 0, elapsedMs: 0 });

  // Only while something is running. The elapsed figure is the cheapest signal
  // that a long turn is alive rather than wedged, and it is worthless if it only
  // updates when a round happens to finish.
  React.useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => {
      setRunClock((c) => (c.startedAt ? { ...c, elapsedMs: Date.now() - c.startedAt } : c));
    }, 1000);
    return () => clearInterval(id);
  }, [streaming]);

  const [toolProgress, setToolProgress] = React.useState<Record<string, string>>({});
  const appendToolProgress = React.useCallback((callId: string, chunk: string) => {
    setToolProgress((p) => {
      const prior = p[callId] ?? "";
      // Bounded: a runaway print loop must not put megabytes into React state.
      if (prior.length > 16_000) return p;
      return { ...p, [callId]: prior + chunk };
    });
  }, []);
  // The last fold, for the notice strip and its undo. Only the `folded` flags
  // are persisted; this is transient UI, so a reload simply stops offering the
  // undo rather than showing a stale one.
  const [foldNotice, setFoldNotice] = React.useState<{
    count: number;
    ids: string[];
    auto: boolean;
  } | null>(null);
  /**
   * The model-written stand-in for this conversation's folded turns.
   *
   * State *and* a ref: the health meter needs it to re-render, and the two async
   * paths that build a request (`streamInto`, the repair round) run inside
   * closures that were captured before it landed. Reading a stale one there
   * would send the mechanical excerpt while the badge showed the real summary —
   * the exact drift `request.ts` exists to prevent, reintroduced one level up.
   *
   * `applyFold` checks the fingerprint, so a summary left over from an older
   * fold is ignored rather than trusted.
   */
  const [foldSummary, setFoldSummary] = React.useState<FoldSummary | null>(null);
  const foldSummaryRef = React.useRef<FoldSummary | null>(null);
  React.useEffect(() => {
    foldSummaryRef.current = foldSummary;
  }, [foldSummary]);
  const [atBottom, setAtBottom] = React.useState(true);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [memoryOpen, setMemoryOpen] = React.useState(false);
  const [skillsOpen, setSkillsOpen] = React.useState(false);
  // Whether anything is installed, so the `skill` tool isn't offered into an
  // empty registry. Refreshed when the dialog closes.
  const [skillCount, setSkillCount] = React.useState(0);
  const [connectorsOpen, setConnectorsOpen] = React.useState(false);
  const [pluginsOpen, setPluginsOpen] = React.useState(false);
  const [githubOpen, setGithubOpen] = React.useState(false);
  // The plan for the turn in progress (§4, agentic). Null when plan mode is off
  // or the last plan was dismissed.
  const [plan, setPlan] = React.useState<ChatPlan | null>(null);
  // Live view of a research run. Purely informational — the run never waits on it.
  const [researchProgress, setResearchProgress] = React.useState<{
    rounds: RoundReport[];
    done: boolean;
    summary?: string;
    warning?: string | null;
  } | null>(null);
  const [connectors, setConnectors] = React.useState<Connector[]>([]);
  // The in-flight approval prompt. `resolve` is the promise the tool loop is
  // parked on, so a decision resumes the exact call that raised it.
  const [pendingApproval, setPendingApproval] = React.useState<{
    pending: PendingApproval;
    resolve: (approved: boolean) => void;
  } | null>(null);
  const [projectsOpen, setProjectsOpen] = React.useState(false);
  // Project for a not-yet-created chat; once a conversation exists, its own
  // projectId wins.
  const [pendingProjectId, setPendingProjectId] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  // Read by the step loop between steps. A ref, not state, because the loop is
  // an async function already running when Stop is pressed — a state update
  // would not be visible to it until after the next step had started.
  const planStopRef = React.useRef(false);
  // The repair phase outlives the turn that started it, so it needs its own
  // stop flag and its own controller: `abortRef` is nulled in `streamInto`'s
  // finally, which has already run by the time a repair turn is in flight.
  const repairStopRef = React.useRef(false);
  const repairAbortRef = React.useRef<AbortController | null>(null);
  // Whether the turn that produced the artifact was a build. The repair phase
  // outlives that turn — `streamInto`'s locals are long gone by the time a
  // repair round runs — and it must inherit the same verdict, or a build's
  // artifact would be repaired under ordinary-chat budgets.
  const buildModeRef = React.useRef(false);
  const [repair, setRepair] = React.useState<RepairState | null>(null);
  /**
   * Set for the whole turn when detection — not the user — chose build mode.
   *
   * Drives the composer's pre-flight strip. Auto-escalation without this is just
   * spending someone's money quietly, which would be a worse bug than the one
   * detection fixes.
   */
  const [autoBuildTurn, setAutoBuildTurn] = React.useState<{
    conversationId: string;
    reasons: string[];
  } | null>(null);
  /** The pending send held back by the one-time auto-build consent dialog. */
  const [consentPrompt, setConsentPrompt] = React.useState<{
    text: string;
    attachments: Attachment[];
  } | null>(null);
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

  // `messages` is a new array on every streaming flush (~20x/second), and each
  // run kicked off a fresh smooth-scroll animation that cancelled the previous
  // one — the animation never got to finish, which is what made following a
  // streaming response feel stuttery. Most flushes append text without
  // changing the scroll height at all, so skip those.
  const lastScrollHeight = React.useRef(0);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottom) return;
    if (el.scrollHeight === lastScrollHeight.current) return;
    lastScrollHeight.current = el.scrollHeight;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, atBottom]);

  const refreshSkillCount = React.useCallback(() => {
    void listEnabledSkills()
      .then((s) => setSkillCount(s.length))
      .catch(() => setSkillCount(0));
  }, []);
  React.useEffect(refreshSkillCount, [refreshSkillCount]);

  const refreshConnectors = React.useCallback(() => {
    void listEnabledConnectors()
      .then(setConnectors)
      .catch(() => setConnectors([]));
  }, []);
  React.useEffect(refreshConnectors, [refreshConnectors]);

  /**
   * Park the tool loop on a user decision.
   *
   * Returns a promise the loop awaits; `ApprovalDialog` resolves it. If a prompt
   * is somehow already open, the new request is refused rather than queued —
   * stacking prompts would make it ambiguous which call a click approved.
   */
  const requestApproval = React.useCallback(
    (pending: PendingApproval) =>
      new Promise<boolean>((resolve) => {
        setPendingApproval((current) => {
          if (current) {
            resolve(false);
            return current;
          }
          return { pending, resolve };
        });
      }),
    [],
  );

  const decideApprovalPrompt = React.useCallback(
    (approved: boolean, remember: ApprovalRule | null) => {
      setPendingApproval((current) => {
        if (!current) return null;
        if (remember) {
          const connector = connectors.find((c) => c.id === current.pending.connectorId);
          if (connector) {
            void updateConnector(connector.id, {
              approvals: setRule(connector.approvals, current.pending.toolName, remember),
            }).then(refreshConnectors);
          }
        }
        current.resolve(approved);
        return null;
      });
    },
    [connectors, refreshConnectors],
  );

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const activeProjectId = activeConv?.projectId ?? pendingProjectId;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  /**
   * A key that changes when the *settled* history does, not on every flush.
   *
   * `patchMessage` gives `messages` a new identity every 48ms while streaming.
   * Keying the artifact scan on the array meant a full regex pass over every
   * assistant message in the thread, twenty times a second, for the whole of a
   * twenty-round build. The last message is the one being written, and
   * `liveArtifact` already covers it separately — so the expensive scan only
   * needs to re-run when a turn *completes*.
   */
  const settledKey = React.useMemo(
    () =>
      messages
        .slice(0, -1)
        .filter((m) => m.role === "assistant")
        // Length as well as id: artifact self-repair splices new code into an
        // already-settled turn's fence, and an id-only key would not notice.
        .map((m) => `${m.id}:${m.content.length}`)
        .join(","),
    [messages],
  );

  // Finished artifacts in the transcript, with the turn that produced each.
  // Incomplete ones are excluded: a half-written page is worth previewing but
  // must never become a version the user can revert to.
  const messageArtifacts = React.useMemo(() => {
    const out: { messageId: string; art: Artifact }[] = [];
    for (const m of messages.slice(0, -1)) {
      if (m.role !== "assistant") continue;
      const art = extractArtifact(m.content);
      if (art && art.complete !== false) out.push({ messageId: m.id, art });
    }
    // The last turn, once it has settled. Excluded from the key above so a
    // flush does not re-scan, included here so a finished artifact appears the
    // moment the turn ends rather than on the next one.
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && !streaming) {
      const art = extractArtifact(last.content);
      if (art && art.complete !== false) out.push({ messageId: last.id, art });
    }
    return out;
    // `settledKey` stands in for the array: see its comment. `streaming` is what
    // admits the final turn once it stops moving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledKey, streaming, activeId]);

  // The artifact currently being written. This is the fix for the reported
  // failure: it used to take a *closed* fence to detect an artifact at all, so a
  // page that was still streaming — or that the provider truncated — produced
  // nothing to preview and no button to open.
  const liveArtifact = React.useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return null;
    const art = extractArtifact(last.content);
    return art && art.complete === false ? art : null;
  }, [messages]);

  // Resolve the conversation's artifact record and its version history.
  //
  // Backfills on the way: conversations that predate artifact persistence — or
  // that were simply reloaded — have artifacts in their message text but no
  // record. Without this, opening an older artifact would give it no storage
  // namespace, and none of its earlier versions.
  React.useEffect(() => {
    let alive = true;
    if (!activeId) {
      setArtifactRecord(null);
      setStoredFiles([]);
      return;
    }
    const conversationId = activeId;
    void (async () => {
      let recs = await listArtifactsForConversation(conversationId);
      if (recs.length === 0 && messageArtifacts.length > 0) {
        // Every version, in order — not just the latest — so a reloaded
        // conversation keeps its history rather than collapsing to one entry.
        for (const { messageId, art } of messageArtifacts) {
          await recordVersion({
            conversationId,
            messageId,
            path: art.path,
            kind: art.type,
            lang: art.lang,
            title: art.title,
            code: art.code,
          });
        }
        recs = await listArtifactsForConversation(conversationId);
      }
      const files: StoredFile[] = [];
      for (const rec of recs) {
        const versions = await listVersions(rec.id);
        files.push({
          path: pathOf(rec),
          record: rec,
          versions: versions.map((v) => ({
            type: v.kind,
            lang: v.lang,
            code: v.code,
            title: v.title,
            path: pathOf(rec),
            complete: true,
          })),
        });
      }
      if (!alive) return;
      setArtifactRecord(recs[0] ?? null);
      setStoredFiles(files);
    })();
    return () => {
      alive = false;
    };
    // Length, not the array: a streaming flush produces a new array identity
    // every ~48ms and would re-run this constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messageArtifacts.length, artifactTick]);

  // The build workspace, read back from storage.
  //
  // Read here rather than only inside `streamInto` because the panel and the
  // composer both show it, and because it has to be right after a reload with
  // no turn having happened — that is the case the whole feature exists for.
  React.useEffect(() => {
    let alive = true;
    if (!activeId) {
      setWorkspaceSnap(EMPTY_SNAPSHOT);
      return;
    }
    void workspaceSnapshot(activeId).then((snap) => {
      if (alive) setWorkspaceSnap(snap);
    });
    return () => {
      alive = false;
    };
  }, [activeId, workspaceTick]);

  // Generated binaries — .xlsx, .docx, .pdf, plots — listed without their
  // payloads, so a conversation holding sixteen megabytes costs a filename list
  // rather than sixteen megabytes of ArrayBuffer in React state.
  const [blobs, setBlobs] = React.useState<BlobInfo[]>([]);
  React.useEffect(() => {
    let alive = true;
    if (!activeId) {
      setBlobs([]);
      return;
    }
    void listBlobs(activeId)
      .then((rows) => {
        if (alive) setBlobs(rows);
      })
      .catch(() => {
        /* downloads are additive; a failed listing must not break the thread */
      });
    return () => {
      alive = false;
    };
  }, [activeId, blobTick]);

  // What the panel shows, grouped into files.
  //
  // IndexedDB is the source of truth — a tool patch never appears in the
  // transcript — with the transcript as the fallback for a browser where
  // IndexedDB is unavailable, and the in-flight version appended so the preview
  // keeps up while the model writes.
  const artifactFiles = React.useMemo<ArtifactFile[]>(() => {
    const byPath = new Map<string, Artifact[]>();
    const add = (a: Artifact) => {
      const key = a.path || DEFAULT_PATH;
      const list = byPath.get(key);
      if (list) list.push(a);
      else byPath.set(key, [a]);
    };

    if (storedFiles.length) {
      for (const f of storedFiles) byPath.set(f.path, [...f.versions]);
    } else {
      for (const m of messageArtifacts) add(m.art);
    }
    if (liveArtifact) add(liveArtifact);

    return [...byPath.entries()].map(([path, versions]) => ({ path, versions }));
  }, [storedFiles, messageArtifacts, liveArtifact]);

  /** Flat count, for the "is there anything to show" checks. */
  const artifactCount = React.useMemo(
    () => artifactFiles.reduce((n, f) => n + f.versions.length, 0),
    [artifactFiles],
  );

  /** The newest artifact across every file — what the `artifact` tool edits. */
  const openArtifactRef = React.useMemo(() => {
    const file =
      artifactFiles.find((f) => f.path === selectedPath) ?? artifactFiles[artifactFiles.length - 1];
    return file ? { path: file.path, artifact: file.versions[file.versions.length - 1] } : null;
  }, [artifactFiles, selectedPath]);


  // ── Resizable frames ────────────────────────────────────────────────────────
  const rootRef = React.useRef<HTMLDivElement>(null);
  const historyToggleRef = React.useRef<HTMLButtonElement>(null);

  // Layout-effect media queries: these decide *sizes*, so the post-paint
  // variant would paint one frame with an off-screen panel still holding its
  // share of the width budget.
  const railVisible = useMediaQueryLayout("(min-width: 1024px)");
  const artifactDocked = useMediaQueryLayout("(min-width: 1280px)");

  const chatSheetFraction = useLayoutStore((s) => s.chatSheetFraction);
  const setChatSheetFraction = useLayoutStore((s) => s.setChatSheetFraction);
  const railTab = useLayoutStore((s) => s.chatRailTab);
  const setRailTab = useLayoutStore((s) => s.setChatRailTab);
  /**
   * The user picked a tab during this turn, so stop moving it for them.
   *
   * Choreography, not surprise: the rail follows the work — a run opens Run, a
   * finished artifact opens Preview — right up until someone disagrees, at which
   * point their choice holds for the rest of the turn. Cleared on the next send.
   */
  const [pinnedTab, setPinnedTab] = React.useState(false);
  /**
   * The user closed the rail during this turn.
   *
   * Same lifecycle as `pinnedTab` and for the same reason: every auto-open below
   * is choreography, and choreography stops the moment someone disagrees with
   * it. Cleared at the top of `send`.
   */
  const [closedThisTurn, setClosedThisTurn] = React.useState(false);
  const pickRailTab = React.useCallback(
    (tab: RailTab) => {
      setPinnedTab(true);
      setRailTab(tab);
    },
    [setRailTab],
  );

  // Everything `lib/chat/rail-state.ts` needs to decide what the rail does. The
  // rules themselves live there, where they can be tested — the previous ones
  // were inline here, and the one that mattered was wrong.
  const toolCount = messages[messages.length - 1]?.toolCalls?.length ?? 0;
  const railSignals = React.useMemo(
    () => ({
      hasConversation: !!activeId,
      artifactCount,
      workspaceFileCount: workspaceSnap.files.length,
      producedFileCount: blobs.length,
      toolCallCount: toolCount,
      streaming,
    }),
    [activeId, artifactCount, workspaceSnap.files.length, blobs.length, toolCount, streaming],
  );
  const railUser = React.useMemo(
    () => ({ open: artifactOpen, closedThisTurn, pinnedTab }),
    [artifactOpen, closedThisTurn, pinnedTab],
  );
  const artifactShown = computeRailShown(railSignals, railUser);

  /**
   * Open the rail, unless the user has closed it this turn.
   *
   * One function rather than three scattered `setArtifactOpen(true)` calls — the
   * three were all artifact-gated, which is exactly why a build could run for
   * twenty rounds with the Run panel unreachable.
   */
  const openRail = React.useCallback((reason: OpenReason) => {
    void reason; // named for the reader and for future telemetry
    setArtifactOpen(true);
  }, []);

  // Auto-open and auto-focus, both from the same rules. `buildStarting` is
  // signalled by `streamInto` before the first stream round; the rest are
  // observed transitions.
  const priorArtifactCount = React.useRef(artifactCount);
  const priorFileCount = React.useRef(workspaceSnap.files.length + blobs.length);
  React.useEffect(() => {
    const fileCount = workspaceSnap.files.length + blobs.length;
    const event = {
      artifactAppeared: artifactCount > priorArtifactCount.current,
      filesAppeared: fileCount > priorFileCount.current,
    };
    priorArtifactCount.current = artifactCount;
    priorFileCount.current = fileCount;

    if (autoOpen(railSignals, railUser, event)) setArtifactOpen(true);
    const next = autoTab(railSignals, railUser, event);
    if (next) setRailTab(next);
  }, [railSignals, railUser, artifactCount, workspaceSnap.files.length, blobs.length, setRailTab]);

  const chatSpecs = React.useMemo<PanelSpec[]>(
    () => [
      {
        key: "chatHistory",
        cssVar: "--atlas-chat-history",
        constraints: CHAT_HISTORY,
        axis: "x",
        anchoredRight: false,
        centerMin: CHAT_CENTER_MIN,
        label: "Chat history",
        active: railVisible,
        toggleRef: historyToggleRef,
      },
      {
        key: "chatArtifact",
        cssVar: "--atlas-chat-artifact",
        constraints: CHAT_ARTIFACT,
        axis: "x",
        anchoredRight: true,
        centerMin: CHAT_CENTER_MIN,
        label: "Artifact panel",
        // Width, not mount state: closed means zero extent, so it takes no part
        // in the budget and its handle is inert.
        active: artifactDocked && artifactShown,
      },
    ],
    [railVisible, artifactDocked, artifactShown],
  );

  const chatPanels = useResizableSurface(rootRef, chatSpecs);
  const history = chatPanels.chatHistory;
  const artifact = chatPanels.chatArtifact;

  // Mobile sheet: raw pointer events rather than framer's `drag`, which
  // translates the element. We need the box to *grow*, otherwise the artifact
  // just slides off the bottom of the screen instead of revealing more of
  // itself. Enter/exit stays with framer.
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const sheetDrag = React.useRef<{
    startY: number;
    startPx: number;
    fraction: number;
    velocity: number;
    lastY: number;
    lastT: number;
  } | null>(null);

  const sheetGrabberProps: React.HTMLAttributes<HTMLDivElement> & { tabIndex: number } = {
    role: "separator",
    tabIndex: 0,
    "aria-orientation": "horizontal",
    "aria-label": "Resize artifact sheet",
    "aria-controls": artifact.id,
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      sheetDrag.current = {
        startY: e.clientY,
        startPx: sheetRef.current?.offsetHeight ?? 0,
        fraction: chatSheetFraction,
        velocity: 0,
        lastY: e.clientY,
        lastT: performance.now(),
      };
      document.body.classList.add("atlas-resizing-y");
      document.body.setAttribute("data-atlas-resizing", "");
    },
    onPointerMove: (e) => {
      const d = sheetDrag.current;
      if (!d) return;
      const vh = window.innerHeight;
      // Dragging up (negative delta) makes the sheet taller.
      const px = clamp(d.startPx - (e.clientY - d.startY), vh * 0.2, vh * 0.92);
      const now = performance.now();
      d.velocity = ((e.clientY - d.lastY) / Math.max(1, now - d.lastT)) * 1000;
      d.lastY = e.clientY;
      d.lastT = now;
      d.fraction = px / vh;
      if (sheetRef.current) sheetRef.current.style.height = `${Math.round(px)}px`;
    },
    onPointerUp: () => {
      const d = sheetDrag.current;
      sheetDrag.current = null;
      document.body.classList.remove("atlas-resizing-y");
      document.body.removeAttribute("data-atlas-resizing");
      if (!d) return;

      // Flung down from the lowest stop, or dragged under it: close instead of
      // leaving a sliver of sheet on screen.
      if (d.fraction < SHEET_MIN || (d.velocity > 500 && d.fraction <= SHEET_SNAPS[0])) {
        setArtifactOpen(false);
        return;
      }
      const snapped = snapFraction(d.fraction, SHEET_SNAPS, d.velocity);
      // Write the target before the state lands so the CSS transition animates
      // from where the finger left off rather than jumping a frame first.
      if (sheetRef.current) {
        sheetRef.current.style.height = `${(snapped * 100).toFixed(2)}dvh`;
      }
      setChatSheetFraction(snapped);
    },
    onKeyDown: (e) => {
      const idx = SHEET_SNAPS.indexOf(snapFraction(chatSheetFraction, SHEET_SNAPS, 0));
      const next =
        e.key === "ArrowUp" ? idx + 1 : e.key === "ArrowDown" ? idx - 1 : null;
      if (next === null) return;
      e.preventDefault();
      if (next < 0) {
        setArtifactOpen(false);
        return;
      }
      setChatSheetFraction(SHEET_SNAPS[Math.min(next, SHEET_SNAPS.length - 1)]);
    },
  };

  // Capture phase and stopped there, so a composer or Monaco-style editable
  // never sees the chord. Held in a ref so the listener registers once.
  const historyRef = React.useRef(history);
  historyRef.current = history;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "b") return;
      e.preventDefault();
      e.stopPropagation();
      historyRef.current.toggle();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  const sessionCost = React.useMemo(() => sessionCostUsd(messages), [messages]);

  // Computed once and shared with TokenHealthBadge, which used to derive it a
  // second time from the same inputs.
  // The system prompt counts against the window like everything else, and it is
  // not small: memories, the skills index, the connectors index and a build
  // workspace push it toward its 24k-character budget. Leaving it out is why a
  // conversation could report "ok" and still overflow.
  const [systemChars, setSystemChars] = React.useState(0);
  const health = React.useMemo(
    () =>
      measureHealth(
        // Folded, because folding is the thing the meter exists to prompt and a
        // meter that ignores its own remedy reads "critical" forever after the
        // first fold.
        applyFold(messages, foldSummary),
        activeModelId,
        {
          systemChars,
          searchChars: 0,
          // Live from the loop. Zero between turns, which is correct: the tool
          // transcript belongs to one turn and does not survive it.
          toolTranscriptChars: runMeters.contextChars,
        },
      ),
    [messages, activeModelId, systemChars, runMeters.contextChars, foldSummary],
  );

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
  const latest = React.useRef({ tree, regenerate, editUser, patchMessage, selectSibling, send, continueTurn, stop, artifactFiles, pickRailTab, tts, select, setPinned });
  latest.current = { tree, regenerate, editUser, patchMessage, selectSibling, send, continueTurn, stop, artifactFiles, pickRailTab, tts, select, setPinned };

  const handleSibling = React.useCallback((id: string, dir: -1 | 1) => {
    const sib = siblingsOf(latest.current.tree, id);
    const next = sib.index + dir;
    if (next >= 0 && next < sib.ids.length) latest.current.selectSibling(sib.ids[next]);
  }, []);
  const handlePin = React.useCallback((id: string, pinned: boolean) => {
    void latest.current.setPinned(id, !pinned);
  }, []);
  // Fork copies history up to this turn into a separate conversation, and
  // switches to it. Unlike a sibling branch, the original is left untouched.
  //
  // The build has to be copied too. Everything a build is made of is keyed by
  // conversation id, so a fork used to arrive with a transcript describing a
  // page it did not have — and worse, half-arrive, because the artifact
  // backfill rebuilds whatever the transcript still shows a fence for and
  // silently loses the rest (see lib/chat/artifact-remix.ts).
  const handleFork = React.useCallback(async (id: string) => {
    const from = useChatStore.getState().activeId;
    const newId = await useChatStore.getState().forkConversation(id);
    if (!newId) return;
    if (from) {
      const { copyBuild } = await import("@/lib/chat/artifact-remix");
      const copied = await copyBuild(from, newId);
      if (copied.files) setArtifactTick((t) => t + 1);
      if (copied.workspaceFiles) setWorkspaceTick((t) => t + 1);
    }
    announce("Forked into a new conversation");
  }, []);
  /**
   * Take the build into a fresh conversation, leaving the transcript behind.
   *
   * The difference from fork: a fork carries the *conversation* and now brings
   * the build with it, while a remix carries only the build. That is the useful
   * one when a long thread has arrived somewhere good and the history has
   * stopped helping — the model starts from the files rather than from every
   * wrong turn taken on the way to them.
   */
  const handleRemixArtifact = React.useCallback(async () => {
    const state = useChatStore.getState();
    const from = state.activeId;
    if (!from) return;
    const source = state.conversations.find((c) => c.id === from);
    const newId = await state.startConversation(
      `${source?.title ?? "Build"} (remix)`,
      source?.modelId,
      source?.projectId ?? null,
    );
    const { copyBuild } = await import("@/lib/chat/artifact-remix");
    const copied = await copyBuild(from, newId);
    setSelectedPath(null);
    setArtifactTick((t) => t + 1);
    setWorkspaceTick((t) => t + 1);
    announce(
      copied.files
        ? `Remixed ${copied.files} ${copied.files === 1 ? "file" : "files"} into a new chat`
        : "Started a new chat",
    );
  }, []);
  const handleRegenerate = React.useCallback((id: string, modelId?: string) => {
    latest.current.regenerate(id, modelId);
  }, []);
  const handleEdit = React.useCallback((id: string, text: string) => {
    latest.current.editUser(id, text);
  }, []);
  const handleContinue = React.useCallback((id: string) => {
    void latest.current.continueTurn(id);
  }, []);
  const handleOpenSettings = React.useCallback(() => setSettingsOpen(true), []);
  const handleOpenArtifact = React.useCallback(() => setArtifactOpen(true), []);
  // Revert moves the artifact's current-version pointer. Later versions stay in
  // the history, so this is undoable by reverting forward again.
  //
  // Scoped to the file on screen, not to the conversation: reverting while
  // `styles.css` is selected must move that file's pointer, not the page's.
  const selectedRecord = React.useMemo(
    () =>
      storedFiles.find((f) => f.path === selectedPath)?.record ??
      storedFiles[storedFiles.length - 1]?.record ??
      artifactRecord,
    [storedFiles, selectedPath, artifactRecord],
  );
  const handleRevertArtifact = React.useCallback(
    async (versionNumber: number) => {
      const id = selectedRecord?.id;
      if (!id) return;
      const updated = await revertToVersion(id, versionNumber);
      if (updated) {
        setArtifactTick((t) => t + 1);
        announce(`Reverted ${pathOf(updated)} to version ${versionNumber}`);
      }
    },
    [selectedRecord?.id],
  );

  // Open a build on its entry point. Without this the panel lands on whichever
  // file happens to be last, so a page with a stylesheet could open on the CSS —
  // technically a file of the build, obviously not the thing that was asked for.
  React.useEffect(() => {
    if (selectedPath || artifactFiles.length < 2) return;
    const entry = entryPathOf(artifactFiles.map((f) => f.path));
    if (entry) setSelectedPath(entry);
  }, [artifactFiles, selectedPath]);

  /**
   * Everything that belongs to one conversation and nothing else.
   *
   * These were scattered — some reset by their own effect, some not at all — so
   * opening conversation B after a build in A showed A's spend, A's elapsed
   * time and A's selected file, attributed to B. One block, so the next atom
   * added here has an obvious home.
   *
   * `workspaceSnap`, `blobs`, `storedFiles` and `artifactRecord` are not listed:
   * each is already re-read by its own `activeId`-keyed effect.
   */
  React.useEffect(() => {
    priorArtifactCount.current = 0;
    priorFileCount.current = 0;
    setRunMeters(EMPTY_RUN_METERS);
    setRunClock({ startedAt: 0, elapsedMs: 0 });
    setToolProgress({});
    setPinnedTab(false);
    setClosedThisTurn(false);
    setSelectedPath(null);
    setFoldNotice(null);
    setFoldSummary(null);
    setResearchProgress(null);
    setAutoBuildTurn(null);
    setRepair(null);
  }, [activeId]);

  /**
   * Read back this conversation's stored fold summary.
   *
   * Declared after the reset block so it runs second on an `activeId` change:
   * cleared, then loaded. Without the clear, conversation B would send A's
   * summary for as long as the read took — and `applyFold`'s fingerprint check
   * would not catch it, because a fingerprint only proves which *fold* a summary
   * describes, not which conversation.
   */
  React.useEffect(() => {
    if (!activeId || !isEnabled("longContext")) return;
    let cancelled = false;
    void loadFoldSummary(activeId).then((s) => {
      if (!cancelled && useChatStore.getState().activeId === activeId) setFoldSummary(s);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Hand the artifact's own runtime errors back to the model. The text comes
  // from model-generated code, so `formatArtifactErrors` labels it as data.
  const handleFixArtifact = React.useCallback((errors: string[]) => {
    latest.current.send(formatArtifactErrors(errors), []);
  }, []);

  // Attribute the preview's errors to the turn that produced the artifact, so
  // the card in the transcript can say "2 errors" without the panel being open.
  const lastArtifactMessageId = messageArtifacts[messageArtifacts.length - 1]?.messageId;
  const handleArtifactErrors = React.useCallback(
    (errors: string[]) => {
      if (!lastArtifactMessageId) return;
      // Merged, never replaced.
      //
      // An empty report is not evidence that the artifact is clean — it is the
      // normal first state of a freshly mounted frame, before anything has had
      // time to throw. Writing `undefined` on it meant that opening the panel
      // erased whatever the headless verification had already recorded, so a
      // known-broken artifact silently lost its error count the moment the user
      // looked at it. Errors are only cleared when a new version is recorded.
      if (!errors.length) return;
      const prev = useChatStore.getState().tree.nodes[lastArtifactMessageId]?.artifactErrors ?? [];
      const merged = [...prev];
      for (const e of errors) if (!merged.includes(e)) merged.push(e);
      if (merged.length === prev.length) return;
      latest.current.patchMessage(lastArtifactMessageId, { artifactErrors: merged });
    },
    [lastArtifactMessageId],
  );

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

    // Decided before any parsing starts. Reading a hundred dropped images into
    // data URLs on the main thread and *then* discovering the request is too
    // large costs a hung tab for an answer that was available up front.
    const { accepted, rejected } = admitFiles(pending.length, files);
    if (rejected.length) {
      setPending((p) => [...p, ...rejected.map((r) => rejectionAttachment(r.name, r.reason))]);
    }
    if (!accepted.length) return;

    setParsing(true);
    for (const f of accepted) {
      const att = await parseAttachment(f);
      setPending((p) => [...p, att]);
    }
    setParsing(false);
  }

  /**
   * Pre-emptive search for the non-tool path.
   *
   * When the model can call `web_search` itself we deliberately skip this:
   * searching every turn regardless of need wastes a request and pollutes the
   * prompt, and it would double up with the model's own call. Models without
   * tool support keep the original always-search-when-toggled behaviour.
   */
  /**
   * One search against the configured backend. Never throws.
   *
   * Returns the reason alongside the results rather than only the results. The
   * route answers 200 with `{ sources: [] }` on every failure so a bad search
   * cannot kill a turn, which means the reason is the only thing distinguishing
   * "nothing matched" from "your key was rejected" — and `web_search` needs that
   * distinction to avoid rephrasing its way through the round budget.
   */
  const runSearch = React.useCallback(
    async (query: string, count = 5): Promise<{ sources: WebSource[]; error?: string }> => {
      try {
        const res = await fetch("/api/v1/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // BYOK: the search key is held in this browser and forwarded once,
            // exactly like the provider key (§1.3).
            ...(searchKey ? { "x-search-key": searchKey } : {}),
          },
          body: JSON.stringify({ query, count, provider: settings.searchProvider }),
        });
        const j = await res.json();
        return {
          sources: Array.isArray(j.sources) ? (j.sources as WebSource[]) : [],
          error: typeof j.error === "string" ? j.error : undefined,
        };
      } catch {
        return { sources: [], error: "The search request did not complete." };
      }
    },
    [searchKey, settings.searchProvider],
  );

  /** Sources only, for the pre-search and research paths that cannot act on a reason. */
  const searchOnce = React.useCallback(
    async (query: string, count = 5): Promise<WebSource[]> =>
      (await runSearch(query, count)).sources,
    [runSearch],
  );

  async function maybeSearch(text: string): Promise<WebSource[] | undefined> {
    if (!text.trim()) return undefined;

    // Research mode (§4.6): fan out several differently-framed queries before
    // answering. Takes precedence over both the tool path and the one-shot
    // pre-search — a model calling `web_search` once would defeat the point.
    // Flag-gated like every other capability of its size. This one was not, so
    // `deepResearch` shipped dark in the flags panel while the composer toggle
    // ran it anyway — a switch whose stated state and actual state disagreed.
    if (settings.research && isEnabled("deepResearch")) {
      setResearchProgress({ rounds: [], done: false });
      const result = await runResearch(text, {
        plan: localPlanner(),
        search: (q) => searchOnce(q, 5),
        signal: abortRef.current?.signal,
        onProgress: (report) =>
          setResearchProgress((p) => ({ rounds: [...(p?.rounds ?? []), report], done: false })),
      });
      setResearchProgress({ rounds: result.rounds, done: true, summary: describeRun(result) });
      return result.sources.length ? result.sources : undefined;
    }

    if (!settings.webSearch) return undefined;
    // When the model can call `web_search` itself, skip the pre-search:
    // searching every turn regardless of need wastes a request and pollutes the
    // prompt, and it would double up with the model's own call.
    const canUseTools = shouldOfferTools(
      toolSupportFor(getModelById(activeModelId), toolNegatives),
    );
    if (canUseTools) return undefined;
    const sources = await searchOnce(text, 5);
    return sources.length ? sources : undefined;
  }

  /**
   * Resolve the one-time auto-build consent dialog and resume the held message.
   *
   * `seenAutoBuild` is set on every path, including the dismissal one: the
   * question has been asked, and asking again would make "once" a lie. What
   * differs is the standing setting and whether the held message runs as a
   * build — declining sets `agenticMode: "off"`, so nothing escalates again
   * until the user turns the Agent control back on themselves.
   */
  async function decideAutoBuild({
    mode,
    proceed,
  }: {
    mode: "off" | "auto" | "always";
    proceed: boolean;
  }) {
    const held = consentPrompt;
    setConsentPrompt(null);
    settings.set({ agenticMode: mode, seenAutoBuild: true });
    if (!held) return;
    // A refusal answers the message as ordinary chat rather than discarding it.
    // The user asked a question; the dialog was about how to answer it.
    if (!proceed && mode !== "off") {
      const id = useChatStore.getState().activeId;
      if (id) setAgenticOverride(id, false);
    }
    await send(held.text, held.attachments);
  }

  function assignProject(projectId: string | null) {
    if (activeId) setProject(activeId, projectId);
    else setPendingProjectId(projectId);
  }

  /**
   * The newest assistant turn, by id.
   *
   * Consumers take its *fields* — `toolCalls`, `reasoning`, `stoppedBy` — never
   * the message. `toolCalls` gets a new identity only when `onToolCalls` fires,
   * a handful of times a turn; the message itself is replaced every 48ms by the
   * streaming flush. Passing the message would put that 20Hz churn straight
   * through the rail.
   */
  const lastAssistantId = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);
  const lastAssistant = lastAssistantId ? (tree.nodes[lastAssistantId] ?? null) : null;

  // Identity-stable for the life of the component, and always current: `latest`
  // is refreshed every render, so these never capture a stale `send`. That is
  // also the fix for an "Edit artifact" action sending against a model the user
  // had already switched away from.
  const handleRailStop = React.useCallback(() => latest.current.stop(), []);
  const handleEditArtifact = React.useCallback(
    (instruction: string) => latest.current.send(editArtifactPrompt(instruction), []),
    [],
  );
  /**
   * Leave this conversation for another.
   *
   * One function because there are two entry points — the desktop rail and the
   * mobile dialog — and they had already drifted to within a line of each other.
   * Everything conversation-scoped is reset by the `activeId` effect above; this
   * only has to stop what is running.
   */
  const switchConversation = React.useCallback((id: string) => {
    latest.current.stop();
    latest.current.tts.cancel();
    setArtifactOpen(false);
    void latest.current.select(id);
  }, []);

  const handleContinueRun = React.useCallback(() => {
    // Read the leaf from the store rather than from a captured value: this
    // button lives in the rail, which outlives any one turn.
    const path = useChatStore.getState().messages;
    for (let i = path.length - 1; i >= 0; i--) {
      if (path[i].role === "assistant") {
        void latest.current.continueTurn(path[i].id);
        return;
      }
    }
  }, []);
  const handleCloseRail = React.useCallback(() => {
    setArtifactOpen(false);
    // Closing is a decision, and it has to outlast the next tool call — every
    // auto-open below would otherwise reopen it within the second.
    setClosedThisTurn(true);
  }, []);
  const handleOpenWorkspaceFile = React.useCallback((path: string) => {
    const rel = toRelativePath(path);
    // Only files that also exist as artifacts have a preview to open.
    if (rel && latest.current.artifactFiles.some((f) => f.path === rel)) {
      setSelectedPath(rel);
      latest.current.pickRailTab("preview");
    }
  }, []);

  const produced = React.useMemo(
    () => blobs.map((b) => ({ path: b.path, size: b.size, mime: b.mime })),
    [blobs],
  );

  /**
   * The rail, mounted once and rendered at both breakpoints.
   *
   * An element rather than a props object: `ChatRailMount` is `React.memo`'d, so
   * what reaches it is compared shallowly and a 48ms content flush no longer
   * rebuilds the panel. Every value below is a primitive, a permanently stable
   * callback, or an array whose identity tracks its contents.
   */
  const railMount = (
    <ChatRailMount
      tab={railTab}
      onTabChange={pickRailTab}
      onClose={handleCloseRail}
      toolCalls={lastAssistant?.toolCalls}
      reasoning={lastAssistant?.reasoning}
      progress={toolProgress}
      streaming={streaming}
      rounds={runMeters.rounds}
      maxRounds={runMeters.maxRounds}
      spentUsd={runMeters.spentUsd}
      maxUsd={runMeters.maxUsd}
      contextChars={runMeters.contextChars}
      contextWindow={
        runMeters.contextChars ? getModelById(activeModelId)?.contextWindow : undefined
      }
      elapsedMs={runClock.elapsedMs}
      runSummary={runMeters.summary}
      onStop={handleRailStop}
      // The stop, as facts. Only once the turn has settled: a Continue button
      // beside a run that is still going would be a control for a state the user
      // is not in.
      stop={
        !streaming && lastAssistant?.stoppedBy && lastAssistant?.stopReason
          ? {
              reason: lastAssistant.stopReason,
              message: lastAssistant.stoppedBy,
              spentUsd: lastAssistant.costUsd,
            }
          : undefined
      }
      onContinueRun={handleContinueRun}
      onOpenSettings={handleOpenSettings}
      workspace={workspaceSnap}
      conversationId={activeId}
      produced={produced}
      artifactFiles={artifactFiles}
      selectedPath={selectedPath}
      onSelectPath={setSelectedPath}
      artifactId={selectedRecord?.id ?? null}
      onRevert={handleRevertArtifact}
      onFix={handleFixArtifact}
      onErrors={handleArtifactErrors}
      onRemix={handleRemixArtifact}
      onEditArtifact={handleEditArtifact}
      onOpenWorkspaceFile={handleOpenWorkspaceFile}
    />
  );

  /**
   * Stream a completion into an existing assistant node. History, system
   * prompt, memory recall and search context are all derived from the current
   * active path, so this powers first-send, regenerate and edit-branch alike.
   */
  async function streamInto(
    asstId: string,
    modelId: string,
    searchSources?: WebSource[],
    /**
     * One plan step, framed for execution. Appended to the SYSTEM prompt rather
     * than pushed into the thread as a user turn: the instruction is machinery,
     * and a generated "Now do exactly this one step…" message sitting in the
     * transcript would be both noise and something the user could edit into an
     * inconsistent state.
     */
    stepInstruction?: string,
    /**
     * Whether to verify the artifact once the turn ends.
     *
     * Defaults to off for a plan step. A step that writes `styles.css`
     * legitimately leaves the previous step's page unstyled, and treating that
     * intermediate state as a failure would halt the plan one step from done.
     * `approveActivePlan` turns it on for the final step only.
     */
    opts?: {
      verify?: boolean;
      /**
       * This turn is picking up a build that ran out of rounds.
       *
       * `count` is how many resumptions this chain has already spent, so the
       * auto-continue allowance is a property of the whole build rather than of
       * each turn — otherwise "resume once" would resume forever, one turn at a
       * time.
       */
      resume?: { count: number; instruction: string };
    },
  ) {
    const verify = opts?.verify ?? !stepInstruction;
    const resumeCount = opts?.resume?.count ?? 0;
    const path = useChatStore.getState().messages;
    // Folded turns are replaced by one derived summary in their chronological
    // place. The transcript is unaffected — this only shrinks the request.
    const history = applyFold(path.filter((m) => m.id !== asstId), foldSummaryRef.current);
    // Both the prompt sentence and the tool gate hang off this, and both are
    // wrong if it is derived from `history` — the fold summary is injected as a
    // plain message there, so by that point nothing is marked folded any more.
    const foldedContext = isEnabled("longContext") && hasFoldedContext(path);
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    const sources = searchSources ?? lastUser?.sources;

    const memories = settings.memory
      ? recallMemories(memItems, lastUser?.content ?? "", 4).map((m) => m.content)
      : [];

    // Project knowledge: stuff whole below the RAG threshold, retrieve above it
    // (§4.5). Retrieval uses the offline lexical embedder by default; a provider
    // embedding model can be substituted here without touching the call site.
    let projectInstructions: string | undefined;
    if (activeProject) {
      const { context } = await resolveProjectContext(
        {
          id: activeProject.id,
          instructions: activeProject.instructions,
          files: activeProject.files.map((f) => ({ name: f.name, text: f.text })),
        },
        lastUser?.content ?? "",
        lexicalEmbedder,
      );
      projectInstructions = context || undefined;
    }

    // Advertise memory file PATHS only (§4.7 progressive disclosure). The model
    // pulls a file with the `memory` tool when a turn calls for it, so a large
    // memory directory costs an index line each, not its full contents.
    let memoryDirectory: string | undefined;
    if (settings.memory) {
      try {
        memoryDirectory = memoryDirectoryBlock(await listMemoryFiles()) || undefined;
      } catch {
        /* memory files are additive context; never block a send on them */
      }
    }

    // Skills index: names and descriptions only. The `skill` tool fetches a body
    // when the model decides a task matches one (§4 Skills).
    let skillsIndex: string | undefined;
    if (settings.skills) {
      try {
        skillsIndex = skillsIndexBlock(await listEnabledSkills()) || undefined;
      } catch {
        /* skills are additive context; never block a send on them */
      }
    }

    // The build workspace: goal, task ledger, file inventory. Re-sent on EVERY
    // turn, which is the whole point — it is the only context that survives
    // compaction folding the messages that described the build away.
    const conversationId = useChatStore.getState().activeId ?? "";
    // The same binding, named for the one place that must not re-read it: the
    // `finally` block, which runs after an abort and therefore possibly after a
    // conversation switch has already landed.
    const turnConversationId = conversationId;
    let workspaceContext: string | undefined;
    let buildStores: BuildStores | null = null;
    let workspaceFileCount = 0;
    if (conversationId) {
      try {
        // The context is read whenever a workspace exists, NOT only in build
        // mode. A conversation that built something and then had build mode
        // switched off kept every file and lost all awareness of them: the model
        // was asked to continue work it could no longer see, which is exactly
        // the "it forgot what we were doing" failure the workspace was added to
        // prevent. `buildWorkspaceContext` returns "" for an empty workspace, so
        // an ordinary chat pays one indexed read and adds nothing to the prompt.
        const snapshot = await workspaceSnapshot(conversationId);
        workspaceFileCount = snapshot.files.length;
        workspaceContext = buildWorkspaceContext(snapshot) || undefined;
      } catch {
        /* additive context; never block a send on it */
      }
    }

    // Whether this is a build. Decided here rather than at the composer so that
    // regenerate and edit-branch inherit the same verdict as the send they came
    // from, and so a follow-up in a conversation that already has files stays in
    // build mode — which is the failure users describe as Atlas forgetting what
    // it was doing.
    const intent = detectBuildIntent({
      text: lastUser?.content ?? "",
      attachments: lastUser?.attachments?.map((a) => ({ kind: a.kind, name: a.name })),
      workspaceFileCount,
      hasOpenArtifact: !!openArtifactRef,
    });
    const agentic = resolveAgentic(
      settings.agenticMode,
      // Read fresh, not from the render-time snapshot: "Just answer" sets the
      // override and immediately re-runs this turn, and a stale closure would
      // rebuild exactly the thing the user just declined.
      conversationId
        ? (useChatStore.getState().agenticOverrides[conversationId] ?? null)
        : null,
      intent,
    );
    const buildMode = agentic.build && !!conversationId;
    buildModeRef.current = buildMode;
    // Shown for the whole turn when detection made the call, so a mode the user
    // did not ask for never runs unannounced.
    setAutoBuildTurn(agentic.auto ? { conversationId, reasons: intent.reasons } : null);

    if (buildMode && conversationId) {
      try {
        // Binding the stores stays gated: they exist to back the `workspace` and
        // `tasks` tools, and those are only offered in build mode. Knowing the
        // build is there is context; being able to write to it is a capability.
        buildStores = await bindWorkspace(conversationId);
      } catch {
        /* the tools refuse rather than writing somewhere unexpected */
      }
    }

    const base = buildSystemPrompt({
      style: settings.style,
      aboutYou: settings.aboutYou,
      responseGuidance: settings.responseGuidance,
      displayName: settings.displayName,
      projectInstructions,
      memories,
      memorySummary: settings.memory ? memorySummary : undefined,
      memoryDirectory,
      skillsIndex,
      // Names what is connected and warns that those tools touch real accounts,
      // so the model announces intent rather than silently reaching for one.
      connectorsIndex: connectorsIndexBlock(connectors) || undefined,
      incognito,
      buildMode,
      workspaceContext,
      // The model cannot ask about turns it does not know were removed. Told
      // they were, it reaches for `recall_context` instead of filling the gap
      // with something plausible.
      hasFoldedContext: foldedContext,
    });
    // Both riders go on the SYSTEM prompt rather than into the thread: they are
    // machinery, and a generated "now continue from step 3" user turn sitting in
    // the transcript would be both noise and something the user could edit into
    // an inconsistent state.
    const rider = stepInstruction ?? opts?.resume?.instruction;
    const system = rider ? `${base}\n\n${rider}` : base;
    // Fed back into the health meter. The prompt is only assembled here — it
    // needs memories, the skills index and the workspace, all of which are
    // async — so the badge reads the previous turn's size rather than rebuilding
    // it on every render. It is stable between turns, so that is the same number
    // in practice, and a first turn that reads 0 is only ever an underestimate
    // of an almost-empty conversation.
    setSystemChars(system.length);
    const routerMessages = buildRequest(history, modelId, system, sources);
    const effort = settings.reasoningEffort;
    const reasoningParam = effort !== "off" ? effort : undefined;

    // Graceful degradation (§1.2): only offer tools to models the capability
    // registry says can use them. Everything else takes the pre-search path.
    // Availability mirrors the user's composer toggles, so nothing runs behind
    // their back — with both off there is nothing to offer and we skip entirely.
    // The artifact as it stands when the turn starts. Captured here rather than
    // read from state inside the tool, because the tool runs inside an async
    // function that closed over this render.
    const openArtifact = openArtifactRef?.artifact ?? null;
    const openArtifactPath = openArtifactRef?.path;
    // Every file of the build, newest version of each — what `artifact list`
    // reports and what a `path=`-addressed patch reads from (§P14). Captured
    // with the rest of the turn's snapshot, for the same reason.
    const openArtifactFiles = artifactFiles
      .map((f) => {
        const latest = f.versions[f.versions.length - 1];
        return latest ? { path: f.path, code: latest.code, lang: latest.lang } : null;
      })
      .filter((f): f is { path: string; code: string; lang: string } => f != null);
    const toolAvailability = {
      webSearch: settings.webSearch,
      hasProject: !!activeProject,
      memory: settings.memory,
      hasSkills: settings.skills && skillCount > 0,
      github: settings.github,
      hasArtifact: !!openArtifact,
      buildMode,
      codeExecution: settings.codeExecution && isEnabled("chatCodeExec") && !!conversationId,
      hasFoldedContext: foldedContext,
      // Build mode only. Three parallel model runs is the most expensive thing
      // one tool call in this app can do, so it is offered only where the user
      // has already opted into a mode that carries a dollar ceiling and shows a
      // meter counting against it.
      subagents: buildMode && isEnabled("chatSubagents"),
    };

    // The interpreter is created only when the tool is on the table, and its
    // ~10MB download does not happen until `runPython` is actually called — so a
    // user who never asks for a calculation pays nothing.
    const exec = toolAvailability.codeExecution
      ? await createExecRuntime(isEnabled("chatPyExecWorker"))
      : undefined;
    // Connector tools are additive: they carry their own approval gate, so they
    // are offered whenever a connector is enabled rather than behind a toggle.
    const mcpDefs = connectorToolDefs(connectors);
    // Derived from the registry, not restated.
    //
    // This was a hand-maintained OR-chain over the same flags `toolDefsFor`
    // filters on — and it had already drifted: `codeExecution` was added to
    // `ToolAvailability` and never to the chain, so a user with only Code
    // execution on was handed no tools at all and answered arithmetic from
    // memory. Asking the registry what it would offer makes that class of bug
    // structurally impossible rather than merely fixed.
    const offeredDefs = [...toolDefsFor(toolAvailability), ...mcpDefs];
    // Fail open on capability. The catalog's `toolUse` is not evidence —
    // `lib/catalog/sync/nvidia.ts` reconstructs models from an id and, unable to
    // confirm tool calling per model, claims `false` for all of them. Gating on
    // that ran every NIM-served model as a single-shot completion with the agent
    // loop switched off, which is the default path for the free catalog. Only a
    // provider's own rejection, learned and remembered, withholds tools now.
    const toolsEnabled =
      shouldOfferTools(toolSupportFor(getModelById(modelId), toolNegatives)) &&
      offeredDefs.length > 0;

    // A skill's `allowed-tools` applies from the moment it is loaded until the
    // end of the turn. Held in a plain local rather than React state because the
    // restriction must be readable by the very next tool call, which happens
    // inside this async function — a state update would not have landed yet.
    let activeSkillTools: string[] | undefined;

    // One budget per turn. In ordinary chat its limits are exactly the previous
    // constants (4 rounds, 3 continuations, 16k), so nothing changes; in build
    // mode it is what keeps 20 rounds from becoming an unbounded bill.
    // Rounds derived from the model on screen. Twenty was chosen when the
    // context window was what a long build ran out of first; on a million-token
    // model the counter would now be the first thing to stop a build that had
    // room to finish. `maxUsd` is still the ceiling that matters.
    // The clock is derived from the model too, and for both modes — a 550B model
    // takes nine minutes to produce one full-length answer, which is longer than
    // an ordinary chat turn was ever allowed to run.
    const budgetModel = getModelById(modelId);
    const budget = new BuildBudget(
      limitsFor(buildMode, {
        ...(buildMode ? { maxRounds: roundsFor(budgetModel?.contextWindow) } : {}),
        maxMs: maxMsFor(budgetModel, limitsFor(buildMode)),
      }),
    );

    setStreaming(true);
    setAtBottom(true);
    // The meters start at zero against this turn's real ceilings, before the
    // first token — which is the whole point of showing them for a mode the user
    // may not have chosen.
    setRunMeters({
      rounds: 0,
      maxRounds: budget.limits.maxRounds,
      spentUsd: 0,
      maxUsd: budget.limits.maxUsd,
      contextChars: 0,
      summary: undefined,
    });
    setRunClock({ startedAt: Date.now(), elapsedMs: 0 });
    setToolProgress({});
    // Open the rail before the first stream round, not on the first tool call.
    // The meters above were just initialised against this turn's real ceilings,
    // and that disclosure is worth nothing if it arrives twenty seconds in —
    // which, when every opener was artifact-gated, is what happened: never.
    if (buildMode && !closedThisTurn) openRail("build-start");

    let acc = "";
    let reasoning = "";
    let errored = false;
    let errorCode: string | undefined;
    const tools: StoredToolCall[] = [];
    // Sources accumulate across tool rounds so every search in a turn is cited.
    const collectedSources: WebSource[] = sources ? [...sources] : [];
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

    /**
     * The fan-out counter, one per turn.
     *
     * A plain object shared by reference with every `executeTool` call this
     * turn. The tool mutates it, so three sequential `spawn_subagents` calls see
     * the count the first one left behind — which is the only place that limit
     * can live, since the schema can only bound one call's arguments.
     */
    const subagentTurn: SubagentTurnState = { calls: 0, agents: 0 };

    /**
     * Run one read-only sub-agent: a `runToolLoop` over the restricted toolset.
     *
     * The nesting is thin on purpose. Everything hard — rounds, continuations,
     * abort, tool-call pairing — is machinery the parent loop already has and
     * that is already tested. What is new here is only *which* tools are on the
     * table and *whose* budget pays.
     */
    const runOneSubagent = async (task: SubagentTask): Promise<SubagentOutcome> => {
      const agentBudget = new BuildBudget({
        ...budget.limits,
        maxRounds: SUBAGENT_LIMITS.maxRounds,
        maxUsd: SUBAGENT_LIMITS.maxUsd,
        maxMs: SUBAGENT_LIMITS.maxMs,
        maxContinuations: 0,
      });
      let spent = 0;
      const result = await runToolLoop(
        [
          { role: "system", content: subagentPrompt(task) },
          { role: "user", content: task.instruction },
        ],
        {
          stream: (messages, toolDefs) =>
            postSSE<WireEvent>(
              "/api/v1/router/chat",
              {
                modelId,
                messages,
                maxTokens: outputBudget(getModelById(modelId)?.maxOutput, 4_000),
                ...(toolDefs?.length ? { tools: toolDefs } : {}),
              },
              // The parent's signal, not a fresh one: Stop has to kill all three.
              ctrl.signal,
              keyHeaders,
            ),
          runTool: (name, rawArgs) =>
            executeTool(name, rawArgs, {
              signal: ctrl.signal,
              search: runSearch,
              projectFiles: activeProject?.files.map((f) => ({ name: f.name, text: f.text })),
              conversationId: useChatStore.getState().activeId ?? undefined,
              embed: lexicalEmbedder,
              githubToken: githubKey || undefined,
              // Read-only by omission, which is most of the guarantee: there is
              // no `writeArtifact`, no `moveArtifact`, no `onProduceFile`, no
              // exec runtime, no memory store and no `runMcpTool` here, so a
              // sub-agent cannot reach them however it is prompted. The
              // workspace is the one exception — reading the build is most of
              // what an investigation is — so it comes with `readOnly`, which
              // the tool itself enforces.
              workspace: buildStores?.files,
              readOnly: true,
            }),
          toolDefs: toolDefsFor({
            webSearch: settings.webSearch,
            hasProject: !!activeProject,
            memory: settings.memory,
            hasSkills: false,
            github: settings.github,
            hasArtifact: false,
            buildMode,
            codeExecution: false,
            hasFoldedContext: foldedContext,
            // Absent from its own toolset: depth is structurally 1.
            subagents: false,
          }).filter((d) => isSubagentTool(d.function.name)),
          maxRounds: SUBAGENT_LIMITS.maxRounds,
          maxContinuations: 0,
          shouldStop: () => agentBudget.stop(),
        },
        {
          onUsage: (u) => {
            const cost = messageCostUsd(modelId, u.promptTokens, u.completionTokens, u.imageTokens);
            spent += cost;
            agentBudget.chargeUsd(cost);
          },
        },
      );
      return {
        report: result.content,
        spentUsd: spent,
        rounds: result.rounds,
        stopReason: result.stoppedBy,
      };
    };

    try {
      const outcome = await runToolLoop(
        routerMessages as LoopMessage[],
        {
          stream: (messages, toolDefs) =>
            postSSE<WireEvent>(
              "/api/v1/router/chat",
              {
                modelId,
                messages,
                reasoningEffort: reasoningParam,
                // Chat used to send no budget at all, so every turn ran at
                // whatever the route defaulted to — under half a landing page on
                // many of them, and the truncation was invisible.
                maxTokens: outputBudget(
                  getModelById(modelId)?.maxOutput,
                  budget.limits.outputCeiling,
                ),
                ...(toolDefs ? { tools: toolDefs } : {}),
              },
              ctrl.signal,
              keyHeaders,
            ),
          runTool: (name, args, callId) =>
            executeTool(name, args, {
              signal: ctrl.signal,
              // The same keyed, provider-aware caller the pre-search path uses.
              // Passing the function rather than the key keeps the secret out of
              // the tool module and keeps the two callers from drifting apart.
              search: runSearch,
              exec,
              // Read at call time, not captured: a build that wrote three files
              // in the previous round should find them in the interpreter's
              // working directory.
              execMount: async () => {
                if (!conversationId) return [];
                const snap = await workspaceSnapshot(conversationId);
                return snap.files.map((f) => ({
                  path: toRelativePath(f.path) ?? f.path,
                  text: f.content,
                }));
              },
              // Where a produced file lands depends on what it is. Text goes to
              // the workspace, so it inherits the preview, version history and
              // bundler every other build file has; bytes go to their own store,
              // because a .xlsx cannot survive a UTF-8 round trip.
              onExecFile: async (file) => {
                if (!conversationId) return;
                if (file.bytes) {
                  const buf = file.bytes.buffer.slice(
                    file.bytes.byteOffset,
                    file.bytes.byteOffset + file.bytes.byteLength,
                  ) as ArrayBuffer;
                  const written = await writeBlob(conversationId, file.path, buf);
                  // Refused rather than saved — the caps in `blob-repo.ts` are a
                  // refusal, not an eviction, so throw and let the tool report
                  // it. A file that quietly failed to save is the failure this
                  // whole path exists to prevent.
                  if (!written.ok) throw new Error(written.reason ?? "not saved");
                  setBlobTick((t) => t + 1);
                  // Pinned to the turn that made it, so the deliverable is
                  // offered where the user is looking rather than only in a
                  // panel they may not have open.
                  patchMessage(asstId, {
                    producedFiles: [
                      ...(useChatStore.getState().tree.nodes[asstId]?.producedFiles ?? []).filter(
                        (f) => f.path !== file.path,
                      ),
                      { path: file.path, size: buf.byteLength, mime: mimeForPath(file.path) },
                    ],
                  });
                  return;
                }
                const stores = buildStores ?? (await bindWorkspace(conversationId));
                const abs = toWorkspacePath(file.path);
                if (abs) {
                  await stores.files.write(abs, file.text ?? "");
                  setWorkspaceTick((t) => t + 1);
                }
              },
              onToolProgress: (chunk) => appendToolProgress(callId, chunk),
              subagentTurn,
              // What the build has left, so a fan-out it could not afford to
              // finish is refused rather than started.
              subagentHeadroomUsd: budget.limits.maxUsd - budget.spentUsd,
              spawnSubagents: async (tasks) => {
                const out = await runSubagents(tasks, {
                  signal: ctrl.signal,
                  runOne: runOneSubagent,
                  // Charged as each agent settles, not when the merged report
                  // returns — otherwise the meter reads $0.30 while $1.05 has
                  // already gone, and the user watching it has no other signal.
                  charge: (usd) => budget.chargeUsd(usd),
                  // Rides the same progress channel `run_python`'s terminal
                  // uses, so the Run panel gets live nested state with no new
                  // plumbing between the tool, the loop and the UI.
                  onProgress: (agents) =>
                    appendToolProgress(callId, encodeSubagentProgress(agents)),
                });
                return { content: out.content };
              },
              projectFiles: activeProject?.files.map((f) => ({ name: f.name, text: f.text })),
              conversationId: useChatStore.getState().activeId ?? undefined,
              embed: lexicalEmbedder,
              githubToken: githubKey || undefined,
              artifact: openArtifact
                ? {
                    code: openArtifact.code,
                    title: openArtifact.title,
                    lang: openArtifact.lang,
                    path: openArtifactPath ?? DEFAULT_PATH,
                    files: openArtifactFiles,
                  }
                : undefined,
              // A patched version is committed straight to the store. It never
              // appears in the transcript — that is the point, the model paid
              // for the fragment rather than the whole document — so the panel
              // reads its history from the store rather than from message text.
              writeArtifact: async (code, path) => {
                const convId = useChatStore.getState().activeId;
                if (!convId || !openArtifact) return;
                // A named path may be a file this build already has, or a new
                // one. `kind`/`lang`/`title` come from the sibling when there is
                // one, and from the open file otherwise — a new `styles.css`
                // next to an HTML page should not inherit "html".
                const target = path ?? openArtifactPath;
                const sibling = target
                  ? artifactFiles.find((f) => f.path === target)
                  : undefined;
                const from = sibling?.versions[sibling.versions.length - 1];
                await recordVersion({
                  conversationId: convId,
                  path: target,
                  kind: from?.type ?? (path ? kindAndLangForPath(path).kind : openArtifact.type),
                  lang: from?.lang ?? (path ? kindAndLangForPath(path).lang : openArtifact.lang),
                  title: from?.title ?? path ?? openArtifact.title,
                  code,
                });
                setArtifactTick((t) => t + 1);
                setArtifactOpen(true);
              },
              // Delete and rename go through their own seam rather than through
              // `writeArtifact`, because neither produces a version and the
              // panel has to re-read the file list rather than a new version of
              // one file.
              moveArtifact: async (from, to) => {
                const convId = useChatStore.getState().activeId;
                if (!convId) return { ok: false as const, reason: "unavailable" as const };
                const result = to
                  ? await renameArtifact(convId, from, to)
                  : await softDeleteArtifact(convId, from);
                if (result.ok) {
                  // A removed or moved file may be the one on screen; clearing
                  // the selection lets the panel fall back to whatever remains
                  // rather than showing an empty pane.
                  setSelectedPath(to ?? null);
                  setArtifactTick((t) => t + 1);
                }
                return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
              },
              // Bound to this conversation before the tool ever sees it, so the
              // tool has no way to address another conversation's build. Both
              // are undefined outside build mode, and the tools refuse rather
              // than writing somewhere unexpected.
              workspace: buildStores?.files,
              tasks: buildStores?.ledger,
              onWorkspaceChanged: () => setWorkspaceTick((t) => t + 1),
              allowedTools: activeSkillTools,
              onSkillLoaded: (s) => {
                activeSkillTools = s.allowedTools;
              },
              runMcpTool: (name, args) =>
                runMcpTool(name, args, {
                  connectors,
                  requestApproval,
                  invoke: async (c, toolName, toolArgs) => {
                    const full = connectors.find((x) => x.id === c.id);
                    if (!full) return { content: "Connector is no longer available.", isError: true };
                    return callConnectorTool(full, toolName, toolArgs, { signal: ctrl.signal });
                  },
                }),
            }),
          toolDefs: toolsEnabled ? offeredDefs : [],
          maxRounds: budget.limits.maxRounds,
          maxContinuations: budget.limits.maxContinuations,
          shouldStop: () => budget.stop(),
          // What actually lets a long build finish. The loop re-sends every
          // prior round's tool results on every round, so round fifteen carries
          // rounds one to fourteen in full — measuring that honestly does not
          // raise the ceiling, and this lowers it.
          trimTranscript: isEnabled("transcriptTrim")
            ? // Budgeted against THIS model's window, not a constant. A flat 60k
              // characters is half the window on a 128k model and 1.6% of it on
              // Nemotron 3 Ultra — and trimming at 1.6% cost the agent files it
              // had every right to still remember, which it then re-read until
              // the loop detector killed the build.
              (convo, boundary) =>
                trimToolTranscript(convo, boundary, trimPolicyFor(getModelById(modelId)))
            : undefined,
        },
        {
          onText: (t) => {
            acc = t;
            schedule();
          },
          onReasoning: (r) => {
            reasoning = r;
            schedule();
          },
          onToolCalls: (calls) => patchMessage(asstId, { toolCalls: calls }),
          onSources: (s) => patchMessage(asstId, { sources: s }),
          onUsage: (u) => {
            // Charged from reported usage rather than estimated up front: the
            // ceiling should stop a turn that has actually cost that much, not
            // one predicted to.
            const spent = messageCostUsd(
              modelId,
              u.promptTokens,
              u.completionTokens,
              u.imageTokens,
            );
            if (spent) {
              budget.chargeUsd(spent);
              setRunMeters((s) => ({ ...s, spentUsd: budget.spentUsd }));
            }
            patchMessage(asstId, {
              promptTokens: u.promptTokens,
              completionTokens: u.completionTokens,
              ...(u.imageTokens ? { imageTokens: u.imageTokens } : {}),
            });
          },
          // What a round accomplished, and what it asked for. The rules live in
          // `lib/chat/progress.ts` — they used to be inline here, and counted
          // only writes as progress, which made two rounds of research look
          // identical to a stuck model and halted exactly the builds this guard
          // was meant to protect.
          onRoundComplete: (calls) => {
            budget.completeRound(classifyRound(calls));
            budget.noteCalls(calls.map(callSignature));
            setRunMeters((s) => ({
              ...s,
              rounds: budget.roundsUsed,
              spentUsd: budget.spentUsd,
            }));
            setRunClock((c) => ({ ...c, elapsedMs: budget.elapsedMs }));
          },
          // The third meter. A user watching a long build should see the number
          // that will actually stop it, rather than meeting it as a provider
          // error on round eighteen.
          onContextGrowth: (chars) => setRunMeters((s) => ({ ...s, contextChars: chars })),
          // The route refused the tools it was offered and answered without
          // them. Said out loud on this turn, and remembered so the next turn
          // does not pay for the same downgrade round trip.
          onCapability: (capability) => {
            if (capability !== "tools") return;
            recordToolsUnsupported(modelId);
            patchMessage(asstId, { capabilityNote: TOOL_DOWNGRADE_NOTE });
          },
          onError: (e) => {
            errored = true;
            errorCode = e.code;
            clearFlush();
            if (e.code === "key_required") setKeyModalOpen(true);
            patchMessage(asstId, { content: e.message, error: true });
          },
          // Shown live rather than only at the end: a resume costs a full round
          // trip, and the alternative is a stall the user cannot account for.
          onContinue: (attempt) => patchMessage(asstId, { continuations: attempt }),
          // Painted as they arrive. An image model often sends the picture
          // before any text, so waiting for the turn to end would leave the
          // user watching an empty bubble for the whole generation.
          onImages: (imgs) => patchMessage(asstId, { attachments: toGeneratedAttachments(imgs) }),
        },
      );

      acc = outcome.content;
      reasoning = outcome.reasoning;
      for (const s of outcome.sources) {
        if (!collectedSources.some((x) => x.url === s.url)) collectedSources.push(s);
      }
      tools.length = 0;
      tools.push(...outcome.toolCalls);

      // A build that could not get its file through a tool call gets one more
      // chance, in the one channel the model has already proved it can use.
      //
      // Measured on Nemotron 3 Ultra: 48,992 characters of a complete NASA
      // landing page when asked in prose, and zero tool calls across three runs
      // and two direct probes when asked to write the same file through
      // `workspace create`. See `lib/chat/prose-fallback.ts`. Gated hard — the
      // round must have produced nothing at all, and the turn must still have
      // budget — so the common case never pays for it.
      let proseFiles: ProseFile[] = [];
      if (
        buildMode &&
        !ctrl.signal.aborted &&
        !budget.exhausted &&
        conversationId &&
        shouldFallBackToProse({
          stalled: outcome.stalled,
          errored,
          errorCode,
          content: outcome.content,
          filesWritten: (await workspaceSnapshot(conversationId)).files.length,
        })
      ) {
        patchMessage(asstId, { content: "Retrying without tools…" });
        let text = "";
        // Resumed exactly like an ordinary answer. Without this the fallback
        // hands back whatever fitted in one output budget, and a landing page
        // does not: the first live run of this path produced 939 lines of a page
        // whose stylesheet stopped mid-rule, which renders as an unstyled
        // document and reads as a worse failure than none.
        for (let resume = 0; ; resume++) {
          const prior = text;
          let segment = "";
          let finish: string | undefined;
          for await (const ev of postSSE<WireEvent>(
            "/api/v1/router/chat",
            {
              modelId,
              messages: [
                ...(routerMessages as LoopMessage[]),
                { role: "user", content: PROSE_FALLBACK_INSTRUCTION },
                ...(prior
                  ? [
                      { role: "assistant", content: prior },
                      { role: "user", content: RESUME_INSTRUCTION },
                    ]
                  : []),
              ],
              reasoningEffort: reasoningParam,
              maxTokens: outputBudget(getModelById(modelId)?.maxOutput, budget.limits.outputCeiling),
            },
            ctrl.signal,
            keyHeaders,
          )) {
            if (ev.type === "delta") {
              segment += ev.text;
              text = prior ? stitch(prior, segment) : segment;
              acc = text;
              schedule();
            } else if (ev.type === "usage") {
              const spent = messageCostUsd(modelId, ev.promptTokens, ev.completionTokens);
              if (spent) budget.chargeUsd(spent);
            } else if (ev.type === "done") {
              finish = ev.finishReason;
            }
          }
          patchMessage(asstId, { continuations: resume + 1 });
          if (!shouldContinue(finish, resume, budget.limits.maxContinuations)) break;
          if (budget.exhausted || ctrl.signal.aborted) break;
        }
        proseFiles = filesFromProse(text);
        if (proseFiles.length) {
          // The turn produced files after all, so it must stop presenting itself
          // as failed — the error bubble would otherwise sit above a finished
          // page in the Files tab.
          errored = false;
          patchMessage(asstId, { error: undefined });
          const stores = buildStores ?? (await bindWorkspace(conversationId));
          for (const f of proseFiles) {
            const abs = toWorkspacePath(f.path);
            if (abs) await stores.files.write(abs, f.text);
          }
          setWorkspaceTick((t) => t + 1);
        }
        acc = text;
      }

      clearFlush();
      if (!errored) {
        // Citation integrity (§4.6): reconcile the answer against the sources it
        // was actually given, so a marker cannot point at a source that was never
        // retrieved, and the list shown is exactly what the answer cites. Only
        // applied when sources were supplied — otherwise there is nothing to
        // reconcile against and stripping `[1]` would mangle ordinary prose.
        let finalText = acc;
        let finalSources = collectedSources;
        let warning: string | null = null;
        if (collectedSources.length) {
          const reconciled = reconcileCitations(acc, collectedSources);
          warning = groundingWarning(reconciled, true);
          // A model that cited nothing has produced an answer whose sources we
          // cannot vouch for; keep its text and the full list rather than
          // silently dropping every source it ignored.
          if (!reconciled.uncited) {
            finalText = reconciled.text;
            finalSources = reconciled.sources;
          }
        }

        // A stall that produced nothing must say so. Observed on a 550B model:
        // two rounds, a written plan, then the provider went quiet and the turn
        // ended with a blank bubble and no error — indistinguishable from a model
        // that had nothing to say. The workspace and plan really are saved, so
        // asking again continues rather than restarts.
        if (proseFiles.length) {
          finalText = `${finalText}\n\n${proseFallbackNote(proseFiles)}`.trim();
        } else if (outcome.stalled && !finalText.trim()) {
          finalText =
            "The provider stopped sending mid-answer, so this turn produced nothing. " +
            "The plan and workspace are saved — ask again to continue from here. " +
            "A smaller model in the same family will answer far faster if this keeps happening.";
        }

        patchMessage(asstId, {
          content: finalText,
          // A budget stop is carried as structured fields rather than appended
          // to the prose. It used to be one italic line — "Ask again to
          // continue" — which is a dead end dressed as an instruction: the user
          // had to work out what to type, and whatever they typed restated a
          // goal the workspace already knew, so the model redid finished work.
          // `components/chat/budget-stop.tsx` turns it into a control.
          ...(outcome.stoppedBy
            ? { stoppedBy: outcome.stoppedBy, stopReason: outcome.stopReason }
            : {}),
          ...(resumeCount ? { resumeCount } : {}),
          reasoning: reasoning || undefined,
          ...(finalSources.length ? { sources: [...finalSources] } : {}),
          ...(outcome.continuations ? { continuations: outcome.continuations } : {}),
          ...(outcome.truncated ? { truncated: true } : {}),
          ...(outcome.images.length
            ? { attachments: toGeneratedAttachments(outcome.images) }
            : {}),
        });
        if (warning) setResearchProgress((p) => (p ? { ...p, warning } : p));
        announce("Response complete");
        if (settings.voiceAutoRead && finalText) tts.speak(asstId, finalText);
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
      // The run, in one sentence, for the panel footer. Written from the calls
      // that actually happened rather than from the budget, so it says what was
      // produced rather than what was permitted.
      setRunMeters((s) => ({
        ...s,
        rounds: budget.roundsUsed,
        spentUsd: budget.spentUsd,
        summary: summarizeRun(tools, budget.elapsedMs, budget.spentUsd) || undefined,
      }));
      setRunClock((c) => ({ ...c, elapsedMs: budget.elapsedMs }));
      await persistMessage(asstId);

      // The conversation this turn belongs to, captured at the top rather than
      // read here.
      //
      // Switching conversations mid-stream calls `stop()`, which aborts into
      // `catch` and then this block — by which time `select(id)` may already
      // have landed. Reading `activeId` now would record this turn's artifacts,
      // and mirror its workspace, into whichever conversation the user just
      // moved to. Bail instead: the aborted turn has nothing to file.
      const convId = turnConversationId;
      if (convId && useChatStore.getState().activeId !== convId) return;
      const finalText = useChatStore.getState().tree.nodes[asstId]?.content ?? "";
      // Every artifact in the reply, not just the best one.
      //
      // This used to be `extractArtifact` — singular — so a reply containing
      // `index.html` AND `styles.css` recorded one of them and silently dropped
      // the other. With paths that is no longer a cosmetic loss: the second file
      // is what the first one links to.
      //
      // `complete !== false` guards a truncated answer: its fence never closed,
      // so the code is a fragment. It is still previewed — that is the fix — but
      // recording it would put a broken document in the revert history.
      const arts = finalText ? extractArtifacts(finalText).filter((a) => a.complete !== false) : [];
      if (convId && arts.length) {
        try {
          for (const art of arts) {
            await recordVersion({
              conversationId: convId,
              // Only the primary artifact claims the message: two versions of
              // different files sharing a messageId would each overwrite the
              // other on a regenerate.
              messageId: art.path ? undefined : asstId,
              path: art.path,
              kind: art.type,
              lang: art.lang,
              title: art.title,
              code: art.code,
            });
          }
          setArtifactTick((t) => t + 1);
        } catch {
          /* artifact history is additive; never fail the turn over it */
        }
      }

      // Mirror named files into the workspace, whether or not the model used the
      // tool.
      //
      // The prompt asks it to call `workspace`; models frequently write the
      // fence instead, and a build that only persists when the model remembers
      // to call a tool is a build that intermittently loses itself. So the fence
      // is a write path too: anything the model named with `path=` lands in the
      // workspace by the same route it would have taken. The tool stays the
      // better option — it can patch, and it can exceed one reply — but neither
      // is load-bearing on its own.
      if (convId && buildMode) {
        try {
          const named = arts.filter((a) => a.path && a.code.trim());
          if (named.length) {
            const stores = buildStores ?? (await bindWorkspace(convId));
            for (const a of named) {
              const abs = toWorkspacePath(a.path!);
              if (abs) await stores.files.write(abs, a.code);
            }
          }

          // …and the reverse direction, which is the one that was missing.
          //
          // A model that followed the BUILD instructions and wrote every
          // deliverable through `workspace.create` produced files that appeared
          // in the workspace strip and rendered NOTHING: the artifact panel is
          // fed by `recordVersion`, and no filesystem write ever called it. So
          // the workspace is mirrored into artifacts here, which gives those
          // files preview, version history, revert and the bundler — all of
          // which are already keyed by the same relative path.
          const snap = await workspaceSnapshot(convId);
          for (const m of mirrorInputs(snap.files)) {
            await recordVersion({ conversationId: convId, ...m });
          }
          if (snap.files.length) {
            setArtifactTick((t) => t + 1);
            setWorkspaceTick((t) => t + 1);
          }
        } catch {
          /* the workspace mirror is additive; never fail the turn over it */
        }
      }

      // Index the finished thread for past-chat search (§4.7). After the turn,
      // not during it, so a half-streamed reply never lands in the index; and
      // idempotent by fingerprint, so an unchanged thread costs one read.
      // `indexConversation` is itself a no-op in incognito.
      if (convId && settings.memory) {
        const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
        const thread = useChatStore.getState().messages;
        if (conv) {
          void indexConversation(
            { id: conv.id, title: conv.title, updatedAt: conv.updatedAt },
            thread,
            lexicalEmbedder,
          ).catch(() => {
            /* search is a nicety; never surface an indexing failure */
          });
        }
      }
    }

    // Verification and repair run *after* the try/finally, not inside it.
    //
    // Everything in that block is annotated "never fail the turn over it" and
    // runs on abort and on error too. A model turn is none of those things. It
    // also runs before `setStreaming(false)` has been observed, and blocking
    // there for a second of verification plus a whole repair stream would leave
    // Stop dead and the composer disabled with nothing explaining why.
    //
    // One call site, so `send`, `regenerate`, `editUser` and plan steps are all
    // covered without four separate hooks.
    if (verify) await maybeVerifyAndRepair(asstId, modelId);

    // Pick the build back up, if the user has allowed it.
    //
    // Only ever a round-cap stop, and only up to `autoContinueRounds` — which
    // defaults to 0, because an automatic continuation spends money nobody asked
    // for a second time. `shouldAutoResume` refuses a cost, time or loop stop at
    // any setting; those are stops the user has to answer.
    const stopped = useChatStore.getState().tree.nodes[asstId];
    if (
      stopped?.stopReason &&
      isEnabled("autoContinue") &&
      shouldAutoResume(stopped.stopReason as StopReason, resumeCount, settings.autoContinueRounds)
    ) {
      await continueTurn(asstId, modelId);
    }
  }

  /**
   * Resume a build that ran out of rounds.
   *
   * A new assistant turn parented to the stopped one, rather than a regenerate:
   * two turns genuinely happened, the first one's work is real, and replacing it
   * would throw away an answer the user can already read.
   */
  async function continueTurn(stoppedId: string, modelId?: string) {
    if (streaming) return;
    const node = useChatStore.getState().tree.nodes[stoppedId];
    if (!node) return;
    const convId = useChatStore.getState().activeId;
    if (!convId) return;

    // The ledger, not the transcript, is what says where the build got to — it
    // is the one piece of state that survives compaction, which is exactly why
    // the resumed turn is told from it rather than asked to work it out.
    let instruction = "Continue the build from where it stopped.";
    try {
      instruction = resumeInstruction(await workspaceSnapshot(convId));
    } catch {
      /* fall back to the plain instruction; never block a resume on a read */
    }

    const model = modelId ?? node.model ?? activeModelId;
    const newId = uuid();
    await addMessage(
      {
        id: newId,
        role: "assistant",
        content: "",
        model,
        parentId: stoppedId,
        createdAt: Date.now(),
      },
      false,
    );
    await streamInto(newId, model, undefined, undefined, {
      resume: { count: (node.resumeCount ?? 0) + 1, instruction },
    });
  }

  // ── Artifact self-verify and self-repair ──────────────────────────────────

  /**
   * Run the artifact this turn produced, and fix it if it is broken.
   *
   * Silent on success — the artifact simply works, and a notice saying so would
   * be noise about machinery the user did not ask about. Never silent on
   * failure: whatever survives is recorded on the message and surfaced in a
   * dismissible strip, because "Atlas quietly gave up" is worse than the
   * original bug.
   */
  async function maybeVerifyAndRepair(asstId: string, modelId: string) {
    if (!isEnabled("artifactSelfRepair")) return;
    if (!settings.autoVerifyArtifacts) return;
    const convId = useChatStore.getState().activeId;
    if (!convId || typeof window === "undefined") return;

    // Read straight from storage rather than from `artifactFiles`: the versions
    // were written moments ago in the `finally` block and React has not
    // re-rendered, so component state still describes the previous turn.
    const snapshot = async (): Promise<VerifyTarget | null> => {
      const stored = await listArtifactsForConversation(convId);
      const withVersions = await Promise.all(
        stored.map(async (a) => ({
          path: a.path ?? DEFAULT_PATH,
          versions: (await listVersions(a.id)).map((v) => ({ code: v.code, type: v.kind })),
        })),
      );
      return verifyEntryOf(withVersions);
    };

    let target: VerifyTarget | null = null;
    try {
      target = await snapshot();
    } catch {
      return; /* verification is additive; never fail a delivered turn over it */
    }
    if (!target) return;
    const entry = target.entry;

    // One guard for five races: a new send, a regenerate, an edit-branch, a
    // sibling switch and a conversation switch all move the active leaf away
    // from this message or change the conversation.
    const guard = () => {
      const s = useChatStore.getState();
      if (repairStopRef.current) return true;
      if (s.activeId !== convId) return true;
      return s.messages[s.messages.length - 1]?.id !== asstId;
    };

    const limits = repairLimitsFor(buildModeRef.current, {
      maxAttempts: settings.autoRepairAttempts,
      maxUsd: settings.artifactRepairMaxUsd,
    });

    repairStopRef.current = false;
    const { state } = await runArtifactRepair(entry, limits, {
      verify: async () => {
        // Re-read each round: a repair wrote a new version, and verifying the
        // file map from before it would report the errors it just fixed.
        const fresh = await snapshot();
        return fresh ? verifyArtifactInBrowser(fresh, window.location.origin) : null;
      },
      repairTurn: (instruction) => runRepairTurn(asstId, modelId, convId, entry, instruction),
      shouldStop: guard,
      onState: setRepair,
    });

    setRepair(state);
    if (state.status === "gave_up" && state.surviving.length) {
      // Same channel the panel uses, so the transcript card can show a count
      // without the panel ever having been opened.
      patchMessage(asstId, { artifactErrors: state.surviving });
      announce(describeGiveUp(state));
    }
  }

  /**
   * One repair attempt: a second tool loop over the same thread.
   *
   * Deliberately not a new message. The prompt is
   * `[…history, assistant reply, user: instruction]`, which is the same shape
   * the manual "Fix these" button already produces — so there is no novel prompt
   * geometry to validate — but the instruction never lands in the transcript and
   * the reply replaces the artifact rather than appending to the conversation.
   */
  async function runRepairTurn(
    asstId: string,
    modelId: string,
    convId: string,
    entry: string,
    instruction: string,
  ): Promise<{ artifactChanged: boolean; spentUsd: number; errored: boolean }> {
    const node = useChatStore.getState().tree.nodes[asstId];
    const before = node?.content ?? "";

    // The artifact as it stands right now, read from storage rather than from
    // component state, so the `artifact` tool patches the version that just
    // failed verification instead of whatever the panel last rendered.
    let current: { code: string; title: string; lang: string; kind: ArtifactType } | null = null;
    // The build's other files, so a repair can read the module that actually
    // threw rather than only the entry (§P14). An error in `src/Nav.jsx`
    // surfaces at the entry, and patching the entry to fix it is guesswork.
    let currentFiles: { path: string; code: string; lang: string }[] = [];
    try {
      const stored = await listArtifactsForConversation(convId);
      const rec = stored.find((a) => (a.path ?? DEFAULT_PATH) === entry) ?? stored[0];
      const versions = rec ? await listVersions(rec.id) : [];
      const latest = versions[versions.length - 1];
      if (rec && latest) {
        current = { code: latest.code, title: latest.title, lang: latest.lang, kind: latest.kind };
      }
      currentFiles = (
        await Promise.all(
          stored.map(async (a) => {
            const vs = await listVersions(a.id);
            const v = vs[vs.length - 1];
            return v ? { path: a.path ?? DEFAULT_PATH, code: v.code, lang: v.lang } : null;
          }),
        )
      ).filter((f): f is { path: string; code: string; lang: string } => f != null);
    } catch {
      /* the tool simply goes unoffered; the fence path still works */
    }

    const budget = new BuildBudget(REPAIR_LIMITS);
    const ctrl = new AbortController();
    repairAbortRef.current = ctrl;

    const system = buildSystemPrompt({
      style: settings.style,
      displayName: settings.displayName,
      aboutYou: settings.aboutYou,
      responseGuidance: settings.responseGuidance,
      buildMode: buildModeRef.current,
      incognito,
    });
    const history = applyFold(useChatStore.getState().messages, foldSummaryRef.current);
    const messages = [
      ...buildRequest(history, modelId, system),
      { role: "user" as const, content: instruction },
    ];

    let errored = false;
    let spentUsd = 0;
    let text = "";
    let toolWrote = false;

    try {
      const outcome = await runToolLoop(
        messages as LoopMessage[],
        {
          stream: (msgs, toolDefs) =>
            postSSE<WireEvent>(
              "/api/v1/router/chat",
              {
                modelId,
                messages: msgs,
                maxTokens: outputBudget(getModelById(modelId)?.maxOutput, budget.limits.outputCeiling),
                ...(toolDefs?.length ? { tools: toolDefs } : {}),
              },
              ctrl.signal,
              keyHeaders,
            ),
          runTool: (name, args) =>
            executeTool(name, args, {
              signal: ctrl.signal,
              conversationId: convId,
              // Bound to the version recorded moments ago, read straight from
              // storage — `openArtifactRef` was captured when the turn began and
              // React has not re-rendered since the write.
              artifact: current
                ? {
                    code: current.code,
                    title: current.title,
                    lang: current.lang,
                    path: entry,
                    files: currentFiles,
                  }
                : undefined,
              writeArtifact: async (code, path) => {
                if (!current) return;
                const target = path ?? entry;
                const sibling = currentFiles.find((f) => f.path === target);
                await recordVersion({
                  conversationId: convId,
                  path: target,
                  kind: path ? kindAndLangForPath(path).kind : current.kind,
                  // The sibling's own language wins when it has one: it came
                  // from the fence that created the file, which knew more than
                  // the extension does.
                  lang: sibling?.lang ?? (path ? kindAndLangForPath(path).lang : current.lang),
                  title: path ?? current.title,
                  code,
                });
                setArtifactTick((t) => t + 1);
              },
              // Offered in the repair round too: a build that fails because a
              // module was written to the wrong path is fixed by moving it, not
              // by patching around it.
              moveArtifact: async (from, to) => {
                const result = to
                  ? await renameArtifact(convId, from, to)
                  : await softDeleteArtifact(convId, from);
                if (result.ok) {
                  setSelectedPath(to ?? null);
                  setArtifactTick((t) => t + 1);
                }
                return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
              },
            }),
          // Only the artifact tool. A repair round has one job, and offering
          // search or the workspace invites it to spend the user's money on
          // something else.
          toolDefs: toolDefsFor({
            webSearch: false,
            hasProject: false,
            memory: false,
            hasSkills: false,
            github: false,
            codeExecution: false,
            hasArtifact: !!current,
            buildMode: false,
            subagents: false,
            // Same reasoning: a repair round is about the artifact in front of
            // it, not about what the conversation used to say.
            hasFoldedContext: false,
          }),
          maxRounds: budget.limits.maxRounds,
          maxContinuations: budget.limits.maxContinuations,
          shouldStop: () => budget.stop(),
        },
        {
          onText: (t) => {
            text = t;
          },
          onUsage: (u) => {
            const spent = messageCostUsd(
              modelId,
              u.promptTokens,
              u.completionTokens,
              u.imageTokens,
            );
            if (spent) {
              spentUsd += spent;
              budget.chargeUsd(spent);
            }
          },
          onRoundComplete: (calls) => {
            const progress = classifyRound(calls);
            // A repair that did not write is a repair that did not happen, so
            // this stays a strict write check rather than reading the verdict —
            // an `artifact read` is informative to the model and useless here.
            if (
              calls.some(
                (c) => c.name === "artifact" && !/"command"\s*:\s*"read"/.test(c.arguments ?? ""),
              )
            ) {
              toolWrote = true;
            }
            budget.completeRound(progress);
            budget.noteCalls(calls.map(callSignature));
          },
          onError: () => {
            errored = true;
          },
        },
      );
      text = outcome.content || text;
    } catch {
      return { artifactChanged: false, spentUsd, errored: true };
    } finally {
      repairAbortRef.current = null;
    }

    if (errored) return { artifactChanged: false, spentUsd, errored: true };

    // Two ways a model returns a fix, and both have to work: the `artifact` tool
    // (which already wrote its own version) or a fence in the reply.
    let changed = toolWrote;
    const match = extractArtifactMatches(text).find((a) => a.complete !== false && a.code.trim());
    const original = extractArtifactMatches(before).find((a) => a.complete !== false);
    if (match && match.code.trim() !== (original?.code.trim() ?? "")) {
      try {
        await recordVersion({
          conversationId: convId,
          // No messageId: with one, `recordVersion` updates the same-turn
          // version in place and the broken original is lost, taking Diff and
          // Revert with it. Without one, the fix is appended as a new version.
          messageId: undefined,
          // The known path, never `match.path` — a reply that dropped the
          // `path=` attribute would otherwise be filed as a competing artifact
          // under the default name.
          path: entry,
          kind: match.type,
          lang: match.lang,
          title: match.title,
          code: match.code,
        });
        changed = true;
        setArtifactTick((t) => t + 1);
      } catch {
        /* the version history is additive; a failed write is not a repair */
      }

      // Keep the transcript honest: splice the new code into the fence that is
      // already there, by source range, so the model's surrounding prose
      // survives byte-for-byte and the bubble does not show code that has been
      // superseded.
      if (original) {
        patchMessage(asstId, {
          content:
            before.slice(0, original.start) +
            `\`\`\`${match.lang}${match.path ? ` path="${match.path}"` : ""}\n${match.code}\n\`\`\`` +
            before.slice(original.end),
        });
      }
    }

    return { artifactChanged: changed, spentUsd, errored: false };
  }

  // ── Plan mode (§4, agentic execution) ─────────────────────────────────────

  /**
   * Ask the model for a numbered plan.
   *
   * One plain completion with no tools offered: a plan is the model deciding
   * what to do, and handing it tools at that point invites it to start doing it.
   *
   * Returns null whenever there is nothing worth approving — the model declined,
   * the request needs only one step, the call failed, or the user stopped it.
   * The caller then answers normally, so turning plan mode on never turns a
   * simple question into a dead end.
   */
  async function draftPlan(goal: string, modelId: string): Promise<ChatPlan | null> {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let raw = "";
    let failed = false;
    setStreaming(true);
    try {
      for await (const ev of postSSE<WireEvent>(
        "/api/v1/router/chat",
        { modelId, messages: [{ role: "user", content: planPrompt(goal) }] },
        ctrl.signal,
        keyHeaders,
      )) {
        if (ev.type === "delta") raw += ev.text;
        else if (ev.type === "error") failed = true;
      }
    } catch {
      failed = true;
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
    if (failed || declinedToPlan(raw)) return null;
    const steps = parsePlan(raw);
    if (!shouldPlan(steps)) return null;
    return createPlan(uuid(), goal, steps);
  }

  /**
   * Run an approved plan, one step per assistant turn.
   *
   * Each step gets its own message so the user can read what happened at each
   * one, and so branching or regenerating still means what it usually means.
   * Ordering, stopping and the failure rule all live in `runPlanSteps`, where
   * they are testable; this supplies only "how a step is executed here".
   */
  function approveActivePlan() {
    if (!plan || plan.status !== "draft") return;
    const approved = approvePlan(plan);
    setPlan(approved);
    planStopRef.current = false;
    void runPlanSteps(approved, {
      onPlan: setPlan,
      shouldStop: () => planStopRef.current,
      runStep: async (current, step) => {
        const asstId = uuid();
        await addMessage(
          {
            id: asstId,
            role: "assistant",
            content: "",
            model: activeModelId,
            createdAt: Date.now(),
          },
          false,
        );
        // Verify once per plan run, at the last step. Checking after every step
        // would halt working builds: a step that writes `styles.css` leaves the
        // previous step's page unrendered, and that is not a failure.
        await streamInto(asstId, activeModelId, undefined, stepPrompt(current, step), {
          verify: isFinalStep(current, step.id),
        });
        // The verdict is what actually landed in the thread, not the model's
        // account of its own success. Deliberately NOT the verification result:
        // failing the final step sets "the remaining steps were not run" when
        // there are none left, which reads as a lie.
        return { error: !!useChatStore.getState().tree.nodes[asstId]?.error };
      },
    });
  }

  function stopPlan() {
    planStopRef.current = true;
    abortRef.current?.abort();
    setPlan((p) => (p ? abortPlan(p) : p));
  }

  async function send(text: string, atts: Attachment[]) {
    if ((!text.trim() && atts.length === 0) || streaming) return;

    // Abandon any summariser still running from the previous fold. `runSummaryJob`
    // clears this again before it starts, so the fold *this* send may trigger a
    // few lines below is unaffected.
    summaryStopRef.current = true;
    summaryAbortRef.current?.abort();

    // The one-time consent gate for auto-build.
    //
    // Blocking, and only ever once per browser. Build mode raises the round cap
    // fivefold and carries a dollar ceiling, so the first time Atlas decides to
    // enter it on the user's behalf they should be told what that means and get
    // to choose. Asking every time would recreate the friction the whole change
    // exists to remove, which is why `seenAutoBuild` is sticky.
    //
    // Read from the store rather than from the render-time `settings` snapshot:
    // `decideAutoBuild` writes the decision and immediately re-sends the held
    // message, and a stale closure here would reopen the dialog it just closed.
    const live = useSettingsStore.getState();
    if (live.agenticMode === "auto" && !live.seenAutoBuild) {
      const activeConversation = useChatStore.getState().activeId;
      const intent = detectBuildIntent({
        text,
        attachments: atts.map((a) => ({ kind: a.kind, name: a.name })),
        workspaceFileCount: workspaceSnap.files.length,
        hasOpenArtifact: !!openArtifactRef,
      });
      if (
        intent.verdict === "build" &&
        (!activeConversation || agenticOverrides[activeConversation] == null)
      ) {
        setConsentPrompt({ text, attachments: atts });
        return;
      }
    }

    const target = getModelById(activeModelId);
    if (target && modelAccess(target) === "byok" && !hasKey && !providers.servePaid) {
      setKeyModalOpen(true);
      return;
    }

    setInput("");
    setPending([]);
    // A new turn hands the rail back to the choreography. Both of these are
    // corrections to *this* turn's guess, not standing preferences — the
    // standing preference is the persisted tab.
    setPinnedTab(false);
    setClosedThisTurn(false);

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

    // Compact between turns, never mid-turn (R7). Here is the only safe moment:
    // the user's message is recorded, nothing is streaming, and the fold is
    // visible before the answer starts arriving rather than appearing underneath
    // one already in flight.
    if (
      shouldAutoCompact(
        health.usage,
        useChatStore.getState().messages,
        keepRecentFor(getModelById(activeModelId)?.contextWindow),
      )
    ) {
      await compactInPlace(true);
    }

    // Plan mode: draft first and stop. The turn resumes only when the user
    // approves, which is the entire point of the mode — nothing runs on the
    // strength of a plan they have not seen.
    if (settings.planMode && text.trim()) {
      const drafted = await draftPlan(text, activeModelId);
      if (drafted) {
        setPlan(drafted);
        return;
      }
      // Nothing worth planning; fall through and answer directly.
      setPlan(null);
    }

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

    // Branching from a folded turn would answer a question whose context had
    // been summarised away, so unfold the line back to the root first. Cheap,
    // and it makes the new branch behave like any other (R6).
    const all = useChatStore.getState().messages;
    if (all.some((m) => m.folded)) {
      const toUnfold = ancestorsOf(all, userId).filter(
        (id) => all.find((m) => m.id === id)?.folded,
      );
      if (toUnfold.length) await foldMessages(toUnfold, false);
      setFoldNotice(null);
    }

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
    // Stops the plan too: a Stop button that halted one step and then began the
    // next would be the opposite of what it says.
    planStopRef.current = true;
    abortRef.current?.abort();
    // And the repair phase, which runs after the turn's own controller has
    // already been nulled — so it needs its own flag and its own abort, or Stop
    // would leave a model turn running that the user believes they cancelled.
    repairStopRef.current = true;
    repairAbortRef.current?.abort();
    // And the fold summariser, for the same reason: it is a model call the user
    // did not ask for, running after the turn that triggered it has ended. Stop
    // has to mean nothing is still spending.
    summaryStopRef.current = true;
    summaryAbortRef.current?.abort();
    setStreaming(false);
  }

  function start() {
    stop();
    tts.cancel();
    newChat();
    setPlan(null);
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

  /**
   * Compact this conversation in place.
   *
   * The old behaviour opened a NEW conversation and pasted a lossy summary into
   * the composer. Artifacts, versions and the workspace are all keyed by
   * conversation id, so the one action offered for a thread that had grown too
   * long was the one guaranteed to abandon everything it had built. Now the id
   * never changes: earlier turns are marked `folded`, stop being sent, and stay
   * in the transcript behind a disclosure.
   */
  const compactingRef = React.useRef(false);

  /**
   * After a fold: index the folded turns, then have the model write a summary.
   *
   * Deliberately **not awaited** by its caller. The fold happens on the send
   * path, and a summarisation is a whole model round trip — awaiting it would
   * hold the user's message at the composer for several seconds to improve a
   * request that has not been built yet. The fold's own persisted write is
   * awaited, because that one is a single batched put and everything after it
   * depends on it.
   *
   * Every ceiling lives in `runFoldSummary`, where it is unit-tested: one
   * attempt, $0.05 checked before the call, abandoned at every boundary if the
   * user has moved on. This supplies only the four effects.
   */
  const summaryAbortRef = React.useRef<AbortController | null>(null);
  const summaryStopRef = React.useRef(false);
  const runSummaryJob = React.useCallback(
    async (conversationId: string, modelId: string) => {
      summaryStopRef.current = false;
      const ctrl = new AbortController();
      summaryAbortRef.current = ctrl;
      const out = await runFoldSummary(
        { conversationId, model: modelId, messages: useChatStore.getState().messages },
        {
          // One plain completion: no tools, no reasoning effort, nothing written
          // into the transcript. Same shape as `draftPlan`.
          complete: async (system, user) => {
            let raw = "";
            let failed = false;
            for await (const ev of postSSE<WireEvent>(
              "/api/v1/router/chat",
              {
                modelId,
                messages: [
                  { role: "system", content: system },
                  { role: "user", content: user },
                ],
              },
              ctrl.signal,
              keyHeaders,
            )) {
              if (ev.type === "delta") raw += ev.text;
              else if (ev.type === "error") failed = true;
            }
            if (failed) throw new Error("summary call failed");
            return raw;
          },
          // The conversation's own model, priced at its own rate. BYOK means
          // there is no other key we can assume works, and quietly routing
          // someone's conversation elsewhere to save a cent is a surprise.
          estimateUsd: (inputChars, outputChars) =>
            messageCostUsd(modelId, Math.ceil(inputChars / 4), Math.ceil(outputChars / 4)),
          save: saveFoldSummary,
          index: (msgs) => indexFoldedTurns(conversationId, msgs, lexicalEmbedder),
          shouldStop: () =>
            summaryStopRef.current ||
            ctrl.signal.aborted ||
            useChatStore.getState().activeId !== conversationId,
        },
      );
      if (out.summary && useChatStore.getState().activeId === conversationId) {
        setFoldSummary(out.summary);
      }
    },
    [keyHeaders],
  );

  const compactInPlace = React.useCallback(
    async (auto = false) => {
      if (compactingRef.current) return false;
      const current = useChatStore.getState().messages;
      // What the fold keeps is the model's business too. Unlike a trimmed tool
      // result, a folded turn cannot be re-fetched — only recalled through a
      // lossy index — so keeping eight of them on a model with room for forty is
      // the more expensive mistake of the two.
      const plan = planCompaction(current, keepRecentFor(getModelById(activeModelId)?.contextWindow));
      if (!plan) return false;
      compactingRef.current = true;
      try {
        // One batched, persisted write. This was a loop over the in-memory
        // `patchMessage`, which is why a compacted thread un-compacted itself
        // on reload and immediately re-triggered the same auto-fold.
        await foldMessages(plan.foldIds, true);
        setFoldNotice({ count: plan.foldedCount, ids: plan.foldIds, auto });
        // A summary written for the previous, smaller fold is stale the instant
        // this lands. `applyFold` would ignore it on the fingerprint anyway;
        // dropping it here means the meter agrees with the wire in the seconds
        // before the replacement arrives.
        setFoldSummary(null);
        const conversationId = useChatStore.getState().activeId;
        if (conversationId && isEnabled("longContext")) {
          void runSummaryJob(conversationId, useUIStore.getState().activeModelId);
        }
        return true;
      } finally {
        compactingRef.current = false;
      }
    },
    [foldMessages, runSummaryJob],
  );

  /** One-click undo, so an automatic fold is never a decision the user is stuck with. */
  const undoCompaction = React.useCallback(async () => {
    if (!foldNotice) return;
    // Order matters: stop the summariser before unfolding, or it finishes and
    // writes a summary of turns that are back in the conversation.
    summaryStopRef.current = true;
    summaryAbortRef.current?.abort();
    await foldMessages(foldNotice.ids, false);
    setFoldNotice(null);
    setFoldSummary(null);
  }, [foldNotice, foldMessages]);

  const model = getModelById(activeModelId);
  const empty = messages.length === 0;

  return (
    <div ref={rootRef} className="-mb-24 flex h-[calc(100dvh-4rem)] overflow-hidden lg:mb-0">
      {/* History rail. The width lives in a CSS var so dragging it never
          re-renders the message list; the fallback is the 16rem it used to be
          hardcoded to. The right border is the handle's line, not the aside's. */}
      <aside
        id={history.id}
        data-collapsed={history.collapsed}
        className="atlas-panel hidden w-[var(--atlas-chat-history,16rem)] shrink-0 overflow-hidden bg-surface/40 lg:block"
      >
        <HistoryRail
          activeId={activeId}
          onNew={start}
          onSelect={switchConversation}
          onOpenProjects={() => setProjectsOpen(true)}
          onOpenMemory={() => setMemoryOpen(true)}
        />
      </aside>
      <ResizeHandle {...history.handleProps} orientation="vertical" className="hidden lg:block" />

      {/* Thread column */}
      <div className="flex min-w-0 flex-1 flex-col pb-16 lg:pb-0">
        {/* Thread header */}
        <div className="flex h-12 items-center gap-2 border-b border-border px-3 sm:px-4">
          {/* Same slot as the mobile History dialog below, at the opposite
              breakpoint — and the only way back from a collapsed rail for
              anyone who does not know about Ctrl+B. */}
          <Button
            ref={historyToggleRef}
            variant="ghost"
            size="icon-sm"
            className="hidden shrink-0 lg:inline-flex"
            aria-expanded={!history.collapsed}
            aria-controls={history.id}
            title={history.collapsed ? "Show chats (Ctrl+B)" : "Hide chats (Ctrl+B)"}
            onClick={history.toggle}
          >
            {history.collapsed ? (
              <PanelLeft className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </Button>
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
                  onSelect={switchConversation}
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
              <FolderGit2 className="size-3 text-action" />
              <span className="max-w-[8rem] truncate">{activeProject.name}</span>
            </button>
          )}
          {sessionCost > 0 && (
            <span className="hidden text-2xs text-muted-foreground/70 sm:inline">
              {formatUsd(sessionCost)} session
            </span>
          )}
          {!empty && <TokenHealthBadge health={health} />}
          <div className="ml-auto flex items-center gap-1">
            {artifactCount > 0 && (
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
            {/* Header rather than the composer: installing a plugin is a
                workspace-level act, not a per-turn one. */}
            <Button
              variant="ghost"
              size="icon-sm"
              title="Plugins"
              onClick={() => setPluginsOpen(true)}
            >
              <Package className="size-4" />
            </Button>
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
              <EmptyState
                onPick={(p) => send(p, [])}
                disabled={streaming}
                model={getModelById(activeModelId)}
              />
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
                      onFork={handleFork}
                      onContinue={handleContinue}
                      onOpenSettings={handleOpenSettings}
                      conversationId={activeId}
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
                <ArrowDown className="size-3.5 text-action" /> Jump to latest
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {plan && (
          <PlanPanel
            plan={plan}
            busy={streaming}
            onApprove={approveActivePlan}
            onReject={() => setPlan((p) => (p ? rejectPlan(p) : p))}
            onEditStep={(id, text) => setPlan((p) => (p ? editStep(p, id, text) : p))}
            onRemoveStep={(id) => setPlan((p) => (p ? removeStep(p, id) : p))}
            onAbort={stopPlan}
            onDismiss={() => setPlan(null)}
          />
        )}

        {researchProgress && (
          <ResearchProgress
            rounds={researchProgress.rounds}
            done={researchProgress.done}
            summary={researchProgress.summary}
            warning={researchProgress.warning}
            onDismiss={() => setResearchProgress(null)}
          />
        )}

        {/* Compaction happened. Said out loud, with an undo, because folding
            changes what the model can see and a silent change to that is the
            kind of thing people discover by being confused later. */}
        {foldNotice && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-1">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-foreground">
              <Layers className="size-3.5 shrink-0 text-action" />
              <span className="min-w-0">
                {foldNotice.auto ? "Folded" : "You folded"} {foldNotice.count} earlier message
                {foldNotice.count === 1 ? "" : "s"} to free up context. They stay in the
                transcript; your artifacts and workspace are untouched.
                {/* The fold is written to disk everywhere except here, and a
                    notice that implied otherwise would be claiming durability
                    the mode explicitly does not offer. */}
                {incognito && " Temporary chat — this fold lasts for the session only."}
              </span>
              <button
                onClick={() => void undoCompaction()}
                className="ml-auto shrink-0 rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:text-action"
              >
                Undo
              </button>
              <button
                onClick={() => setFoldNotice(null)}
                aria-label="Dismiss"
                className="shrink-0 rounded-md p-1 transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Self-repair, reported only when it did not work.
            A successful repair says nothing: the artifact simply runs, and a
            banner about machinery the user never asked for would be noise. A
            failure is always surfaced, because silently giving up is worse than
            the original bug. "Fix again" goes through the ordinary visible turn
            — by then the user has asked for it, and the transcript should say so. */}
        {repair && repair.status === "gave_up" && repair.surviving.length > 0 && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-1">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-foreground">
              <AlertCircle className="size-3.5 shrink-0 text-danger" />
              <span className="min-w-0">{describeGiveUp(repair)}</span>
              {repair.gaveUpBecause !== "unfixable" && (
                <button
                  onClick={() => {
                    const errs = repair.surviving;
                    setRepair(null);
                    handleFixArtifact(errs);
                  }}
                  className="ml-auto shrink-0 rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:text-action"
                >
                  Fix again
                </button>
              )}
              <button
                onClick={() => setRepair(null)}
                aria-label="Dismiss"
                className={cn(
                  "shrink-0 rounded-md p-1 transition-colors hover:text-foreground",
                  repair.gaveUpBecause === "unfixable" && "ml-auto",
                )}
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* The workspace strip used to sit here. It is the rail's Files tab now:
            it answered the same question as the artifact panel beside it and the
            timeline inside each bubble — what has Atlas made — and having three
            answers in three places is why a build was hard to follow. */}

        {/* Composer */}
        <Composer
          input={input}
          setInput={setInput}
          pending={pending}
          parsing={parsing}
          streaming={streaming}
          webSearch={settings.webSearch}
          memory={settings.memory}
          incognito={incognito}
          skills={settings.skills}
          skillCount={skillCount}
          onToggleSkills={() => settings.toggle("skills")}
          onOpenSkills={() => setSkillsOpen(true)}
          connectorCount={connectors.length}
          onOpenConnectors={() => setConnectorsOpen(true)}
          reasoningEffort={settings.reasoningEffort}
          onReasoningChange={(r) => settings.set({ reasoningEffort: r })}
          // Reported as off whenever the flag is off, so the switch never
          // claims a state the turn will not honour.
          research={settings.research && isEnabled("deepResearch")}
          onToggleResearch={
            isEnabled("deepResearch") ? () => settings.toggle("research") : undefined
          }
          github={settings.github}
          onToggleGithub={() => settings.toggle("github")}
          onOpenGithub={() => setGithubOpen(true)}
          codeExecution={settings.codeExecution}
          onToggleCodeExecution={() => settings.toggle("codeExecution")}
          planMode={settings.planMode}
          onTogglePlanMode={() => settings.toggle("planMode")}
          agenticMode={settings.agenticMode}
          onAgenticModeChange={(mode) => {
            settings.set({ agenticMode: mode, seenAutoBuild: true });
            // Moving the control is a decision about the whole conversation, so
            // it clears any per-turn "just answer" — otherwise a user who
            // declined once and then deliberately chose Build would be quietly
            // overruled by their own earlier click.
            if (activeId) setAgenticOverride(activeId, null);
            setAutoBuildTurn(null);
          }}
          autoBuild={!!autoBuildTurn && autoBuildTurn.conversationId === (activeId ?? "")}
          onDeclineAutoBuild={() => {
            if (activeId) setAgenticOverride(activeId, false);
            setAutoBuildTurn(null);
            // Mid-turn, "Just answer" has to actually answer. Stopping and
            // regenerating re-enters the turn with the override in place, so the
            // user gets the plain reply they asked for rather than a cancelled
            // build and an empty bubble.
            if (streaming) {
              const last = useChatStore.getState().messages.at(-1);
              stop();
              if (last?.role === "assistant") void regenerate(last.id);
            }
          }}
          onToggleWeb={() => settings.toggle("webSearch")}
          onToggleMemory={() => settings.toggle("memory")}
          onToggleIncognito={toggleIncognito}
          onOpenProjects={() => setProjectsOpen(true)}
          hasProject={!!activeProject}
          projectName={activeProject?.name ?? null}
          canEscalate={isEnabled("chatEscalation") && messages.length > 0}
          onEscalate={escalateToCode}
          onSummarize={
            shouldSuggestSummarize(health) &&
            planCompaction(messages, keepRecentFor(model?.contextWindow))
              ? () => void compactInPlace(false)
              : undefined
          }
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

      {/* Artifact panel (desktop). A plain aside, not a motion.aside: binding
          framer's `animate` to a live drag value would put a React render back
          in the pointermove path, and `exit` would race a mid-drag unmount.
          Open/closed now writes the same CSS var the drag does, so there is one
          source of truth and the 460 is no longer duplicated. */}
      {artifactDocked && artifactShown && (
        <ResizeHandle
          {...artifact.handleProps}
          orientation="vertical"
          className="hidden xl:block"
        />
      )}
      <aside
        id={artifact.id}
        className="atlas-panel hidden w-[var(--atlas-chat-artifact,0px)] shrink-0 overflow-hidden xl:block"
      >
        {/* Below xl this must render nothing: `hidden` is display:none, which
            still mounts, and the sheet below would then be a second live
            srcDoc iframe running the same artifact's scripts. */}
        {artifactDocked && artifactShown && (
          <div className="h-full w-[var(--atlas-chat-artifact,0px)] border-l border-border">
            {railMount}
          </div>
        )}
      </aside>

      {/* Artifact sheet (mobile/tablet) */}
      <AnimatePresence>
        {!artifactDocked && artifactShown && (
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
            {/* Height, not `top-12`: the topbar is h-16, so the old inset left
                the sheet overlapping it by 16px. `dvh` because on iOS `vh` is
                the *large* viewport, which runs under the URL bar. */}
            <motion.div
              ref={sheetRef}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              style={{ height: `${(chatSheetFraction * 100).toFixed(2)}dvh` }}
              className="atlas-panel absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-4rem)] flex-col overflow-hidden rounded-t-2xl bg-surface"
            >
              <div
                {...sheetGrabberProps}
                className="group flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center"
              >
                <span
                  aria-hidden
                  className="h-1 w-10 rounded-full bg-border-strong transition-colors group-hover:bg-action group-active:bg-action"
                />
              </div>
              <div className="min-h-0 flex-1">{railMount}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <MemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} />
      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        onChanged={refreshSkillCount}
      />
      <ConnectorsDialog
        open={connectorsOpen}
        onOpenChange={setConnectorsOpen}
        onChanged={refreshConnectors}
      />
      <PluginsDialog
        open={pluginsOpen}
        onOpenChange={setPluginsOpen}
        onChanged={() => {
          refreshSkillCount();
          refreshConnectors();
        }}
      />
      <GithubDialog open={githubOpen} onOpenChange={setGithubOpen} />
      <ApprovalDialog pending={pendingApproval?.pending ?? null} onDecide={decideApprovalPrompt} />
      <AutoBuildDialog open={!!consentPrompt} onDecide={decideAutoBuild} />
      <ProjectsDialog
        open={projectsOpen}
        onOpenChange={setProjectsOpen}
        activeProjectId={activeProjectId}
        onAssign={assignProject}
      />
    </div>
  );
}

// ── Token health badge ────────────────────────────────────────────────────────

function TokenHealthBadge({ health }: { health: ConversationHealth }) {
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

/**
 * Four capabilities, not four prompts.
 *
 * The old cards were example sentences, which answered "what could I type" — a
 * question nobody was stuck on. The one people were stuck on is "what can this
 * thing do", and half the original complaint was that Atlas could already build
 * end to end and nobody knew. So each card names a capability, sets the toggle
 * that enables it, and carries one concrete example of it.
 */
const CAPABILITIES: {
  id: string;
  title: string;
  blurb: string;
  example: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "ridge" | "shelf";
}[] = [
  {
    id: "build",
    title: "Build something",
    blurb: "Multi-round, with a workspace and a plan you can watch.",
    example: "Build a single-page expense tracker with a chart, then write the README",
    icon: Hammer,
    tone: "shelf",
  },
  {
    id: "analyze",
    title: "Analyse data",
    blurb: "Attach a spreadsheet; get real numbers and a file back.",
    example: "Summarise this CSV by month and give me an .xlsx",
    icon: Table2,
    tone: "ridge",
  },
  {
    id: "research",
    title: "Research",
    blurb: "Several searches, reconciled, with numbered citations.",
    example: "Compare the current open-weight models for tool use",
    icon: Telescope,
    tone: "ridge",
  },
  {
    id: "chat",
    title: "Just talk",
    blurb: "One question, one answer, nothing spent.",
    example: "Explain how OAuth PKCE works",
    icon: MessageSquare,
    tone: "ridge",
  },
];

function EmptyState({
  onPick,
  disabled,
  model,
}: {
  onPick: (p: string) => void;
  disabled: boolean;
  /** The active model, so the line below can state what it can actually do. */
  model?: CatalogModel;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-16 text-center">
      <div className="relative mb-5">
        {/* One CSS keyframe, not a canvas. `constellation.tsx` is the bar for a
            persistent surface, but a second RAF loop competing with it for a
            view that disappears on the first message is the wrong trade. */}
        <div className="atlas-empty-glow absolute -inset-8 rounded-full opacity-30 blur-2xl" />
        <AtlasMark size={56} className="relative" />
      </div>
      <h2 className="font-display text-2xl font-semibold tracking-tight">How can Atlas help?</h2>
      {model && (
        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{model.name}</span>
          {model.capabilities.toolUse !== false && <span>· Tools</span>}
          {model.modalities?.includes("vision") && <span>· Vision</span>}
          {model.capabilities.reasoning && <span>· Reasoning</span>}
          <span>· {Math.round(model.contextWindow / 1000)}k context</span>
        </p>
      )}
      <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
        {CAPABILITIES.map((c, i) => (
          <motion.button
            key={c.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            disabled={disabled}
            onClick={() => onPick(c.example)}
            className="surface-card group p-4 text-left transition-all hover:-translate-y-0.5 hover:border-action/40 hover:shadow-lift"
          >
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <c.icon className={cn("size-4", c.tone === "shelf" ? "text-accent" : "text-action")} />
              {c.title}
            </div>
            <p className="text-xs text-muted-foreground">{c.blurb}</p>
            <p className="mt-2 line-clamp-2 text-2xs text-muted-foreground/70 group-hover:text-muted-foreground">
              &ldquo;{c.example}&rdquo;
            </p>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

