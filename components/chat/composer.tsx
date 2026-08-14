"use client";

// Message composer: textarea, attachments, model switcher and the per-turn
// options. Split out of chat-client.tsx.
//
// The bottom row used to carry all sixteen controls as equal-weight icons, which
// read as noise and wrapped to two lines on a phone. It now holds five things —
// the "+" menu, web search, the model, dictation and send — and everything else
// lives in the menu. Hiding a *control* is fine; hiding an *active state* is not,
// so any option set away from its default comes back as a labelled pill just
// above the row. Defaults stay silent, so an ordinary turn shows a bare bar.

import * as React from "react";
import {
  Activity,
  ArrowRightFromLine,
  Brain,
  FolderGit2,
  Github,
  Globe,
  Hammer,
  ListChecks,
  Loader2,
  Mic,
  Paperclip,
  Plug,
  Plus,
  Send,
  Sparkles,
  Square,
  Telescope,
  Terminal,
  VenetianMask,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSwitchItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ModelSwitcher } from "@/components/shell/model-switcher";
import { useDictation } from "@/lib/hooks/use-speech";
import type { ReasoningEffort } from "@/lib/store/settings-store";
import type { Attachment } from "@/lib/chat/types";
import type { AgenticMode } from "@/lib/chat/agentic";
import { BUILD_LIMITS } from "@/lib/chat/build-budget";
import { cn } from "@/lib/utils";

const REASONING_LABEL: Record<ReasoningEffort, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
};

// ── Composer ──────────────────────────────────────────────────────────────────

export function Composer({
  input,
  setInput,
  pending,
  parsing,
  streaming,
  webSearch,
  memory,
  reasoningEffort,
  onReasoningChange,
  incognito,
  skills,
  skillCount,
  connectorCount,
  research,
  github,
  planMode,
  agenticMode,
  onAgenticModeChange,
  autoBuild,
  onDeclineAutoBuild,
  codeExecution,
  onToggleCodeExecution,
  onOpenGithub,
  onToggleGithub,
  onTogglePlanMode,
  onOpenConnectors,
  onToggleResearch,
  onToggleWeb,
  onToggleMemory,
  onToggleIncognito,
  onToggleSkills,
  onOpenSkills,
  onOpenProjects,
  hasProject,
  projectName,
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
  incognito: boolean;
  skills: boolean;
  skillCount: number;
  connectorCount: number;
  onOpenConnectors: () => void;
  research: boolean;
  github: boolean;
  planMode: boolean;
  /** Off / auto-detect / always. Replaces the old build switch. */
  agenticMode: AgenticMode;
  onAgenticModeChange: (mode: AgenticMode) => void;
  /**
   * Set when detection put this turn into build mode.
   *
   * Drives the pre-flight strip. A mode the user did not choose has to announce
   * itself before anything is spent — detection without disclosure would just be
   * spending their money quietly.
   */
  autoBuild?: boolean;
  /** Answer this turn as ordinary chat, and stop auto-building this conversation. */
  onDeclineAutoBuild?: () => void;
  /** Offer the sandboxed Python interpreter. */
  codeExecution: boolean;
  onToggleCodeExecution: () => void;
  onOpenGithub: () => void;
  onToggleGithub: () => void;
  onTogglePlanMode: () => void;
  /** Absent when the feature flag is off — the row is hidden rather than inert. */
  onToggleResearch?: () => void;
  reasoningEffort: ReasoningEffort;
  onReasoningChange: (r: ReasoningEffort) => void;
  onToggleWeb: () => void;
  onToggleMemory: () => void;
  onToggleIncognito: () => void;
  onToggleSkills: () => void;
  onOpenSkills: () => void;
  onOpenProjects: () => void;
  hasProject: boolean;
  projectName?: string | null;
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

  // Only what differs from the default earns a pill. Web search has its own
  // button in the row, and temporary chat has the banner above the textarea, so
  // neither is repeated here.
  const pills: React.ReactNode[] = [];
  // Pills that only exist below `sm`. When they are the whole row, the row has
  // to disappear with them or it leaves a strip of dead space on desktop.
  let mobileOnlyPills = 0;
  if (research && onToggleResearch)
    pills.push(
      <ModePill
        key="research"
        icon={<Telescope className="size-3.5" />}
        label="Research"
        onClear={onToggleResearch}
      />,
    );
  if (planMode)
    pills.push(
      <ModePill
        key="plan"
        icon={<ListChecks className="size-3.5" />}
        label="Plan mode"
        tone="shelf"
        onClear={onTogglePlanMode}
      />,
    );
  // Only the standing "always build" choice earns a pill. An auto-detected build
  // has the pre-flight strip above, which says considerably more, and repeating
  // it here would be the same fact twice in eighty pixels.
  if (agenticMode === "always")
    pills.push(
      <ModePill
        key="build"
        icon={<Hammer className="size-3.5" />}
        label="Always build"
        tone="shelf"
        onClear={() => onAgenticModeChange("auto")}
      />,
    );
  if (codeExecution)
    pills.push(
      <ModePill
        key="code"
        icon={<Terminal className="size-3.5" />}
        label="Python"
        onClear={onToggleCodeExecution}
      />,
    );
  if (github)
    pills.push(
      <ModePill
        key="github"
        icon={<Github className="size-3.5" />}
        label="GitHub"
        onClear={onToggleGithub}
      />,
    );
  // The bar's own reasoning control names its level from `sm:` up, so the pill
  // would only repeat it. Below that the control is hidden and the pill is the
  // only thing standing between you and an unnoticed high-effort turn.
  if (reasoningEffort !== "off") {
    mobileOnlyPills++;
    pills.push(
      <ModePill
        key="reasoning"
        icon={<Zap className="size-3.5" />}
        label={`${REASONING_LABEL[reasoningEffort]} effort`}
        tone="upland"
        className="sm:hidden"
        onClear={() => onReasoningChange("off")}
      />,
    );
  }
  if (!memory)
    pills.push(
      <ModePill
        key="memory"
        icon={<Brain className="size-3.5" />}
        label="Memory off"
        clearLabel="Turn memory back on"
        tone="muted"
        onClear={onToggleMemory}
      />,
    );
  if (!skills && skillCount > 0)
    pills.push(
      <ModePill
        key="skills"
        icon={<Sparkles className="size-3.5" />}
        label="Skills off"
        clearLabel="Turn skills back on"
        tone="muted"
        onClear={onToggleSkills}
      />,
    );
  if (onSummarize)
    pills.push(
      <ModePill
        key="summarize"
        icon={<Activity className="size-3.5" />}
        label="Summarize & continue"
        tone="upland"
        onClick={onSummarize}
      />,
    );

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
            "rounded-2xl border bg-surface/60 p-2.5 shadow-glow transition-colors focus-within:border-action/40",
            dragOver
              ? "border-action/60 bg-action/5"
              : incognito
                ? "border-accent/50 bg-accent/[0.04] focus-within:border-accent/60"
                : "border-border",
          )}
        >
          {/* A mode where nothing is saved has to be impossible to be in by
              accident, so it states itself above the input rather than relying
              on one highlighted icon among eight. */}
          {incognito && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-accent/10 px-2.5 py-1.5 text-2xs text-accent">
              <VenetianMask className="size-3.5 shrink-0" />
              <span>
                Temporary chat — nothing is saved. This conversation disappears when you
                leave it.
              </span>
            </div>
          )}

          {/* Detection put this turn into build mode. Same contract as the
              incognito banner directly above: a mode you could be in without
              having chosen it states itself over the input, names what it costs,
              and offers a way out — before the first token is spent. */}
          {autoBuild && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-accent/10 px-2.5 py-1.5 text-2xs text-accent">
              <Hammer className="size-3.5 shrink-0" />
              <span className="min-w-0">
                Build mode for this turn — up to{" "}
                <span className="tnum">{BUILD_LIMITS.maxRounds}</span> tool rounds, $
                <span className="tnum">{BUILD_LIMITS.maxUsd.toFixed(2)}</span> ceiling.
              </span>
              {onDeclineAutoBuild && (
                <button
                  onClick={onDeclineAutoBuild}
                  className="ml-auto shrink-0 rounded px-1.5 py-0.5 underline decoration-accent/40 underline-offset-2 hover:bg-accent/10 hover:decoration-accent"
                >
                  Just answer
                </button>
              )}
            </div>
          )}

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
            className="max-h-52 w-full resize-none bg-transparent px-2 py-1.5 text-body outline-none placeholder:text-muted-foreground/60"
          />

          {/* Pills get their own line rather than sharing the control row: the
              row is already full to the pixel at 360px, and a state indicator
              that scrolls out of sight is not an indicator. */}
          {pills.length > 0 && (
            <div
              className={cn(
                "no-scrollbar mb-1.5 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5",
                mobileOnlyPills === pills.length && "sm:hidden",
              )}
            >
              {pills}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <ComposerMenu
              webSearch={webSearch}
              onToggleWeb={onToggleWeb}
              research={research}
              onToggleResearch={onToggleResearch}
              memory={memory}
              onToggleMemory={onToggleMemory}
              skills={skills}
              skillCount={skillCount}
              onToggleSkills={onToggleSkills}
              onOpenSkills={onOpenSkills}
              github={github}
              onToggleGithub={onToggleGithub}
              onOpenGithub={onOpenGithub}
              codeExecution={codeExecution}
              onToggleCodeExecution={onToggleCodeExecution}
              connectorCount={connectorCount}
              onOpenConnectors={onOpenConnectors}
              planMode={planMode}
              onTogglePlanMode={onTogglePlanMode}
              agenticMode={agenticMode}
              onAgenticModeChange={onAgenticModeChange}
              incognito={incognito}
              onToggleIncognito={onToggleIncognito}
              reasoningEffort={reasoningEffort}
              onReasoningChange={onReasoningChange}
              hasProject={hasProject}
              projectName={projectName}
              onOpenProjects={onOpenProjects}
              onPickFiles={onPickFiles}
              canEscalate={canEscalate}
              onEscalate={onEscalate}
            />
            {/* Attaching is a one-shot action, so a plain button rather than a
                ComposerToggle — aria-pressed on something that has no pressed
                state is a lie to a screen reader. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onPickFiles}
                  aria-label="Attach files"
                  className="hidden size-10 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:grid"
                >
                  <Paperclip className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                Attach files (images, PDF, docx, csv, xlsx, code)
              </TooltipContent>
            </Tooltip>

            {/* Splits "add something to this turn" from "change how this turn
                runs". Four icons in a row is exactly the undifferentiated block
                this redesign exists to remove; two pairs is not. */}
            <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-border sm:block" />

            {/* The capabilities that stay out of the menu: chosen far more often
                than the rest, and naming their own state saves a tooltip. */}
            <AgentSegment value={agenticMode} onChange={onAgenticModeChange} auto={!!autoBuild} />
            <ComposerToggle
              active={webSearch}
              onClick={onToggleWeb}
              label="Search"
              title={
                webSearch
                  ? "Web search is on — Atlas cites live results"
                  : "Web search — cite live results"
              }
            >
              <Globe className="size-4" />
            </ComposerToggle>

            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              {/* Model and effort, fused into one control.
                  They answer the same question — which brain, and how hard — and
                  Claude puts them together for that reason. It also buys back a
                  slot in a row this file already notes is full to the pixel at
                  360px, which is what made room for the Agent segment. */}
              <div className="flex h-10 min-w-0 items-center rounded-xl border border-border bg-surface-2/40">
                <ModelSwitcher className="h-9 min-w-0 max-w-[7rem] rounded-l-[0.6rem] rounded-r-none border-0 bg-transparent sm:max-w-[12rem]" />
                <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
                <ReasoningSelector
                  value={reasoningEffort}
                  onChange={onReasoningChange}
                  className="hidden h-9 rounded-l-none rounded-r-[0.6rem] sm:inline-flex"
                />
              </div>
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
              {streaming ? (
                <Button variant="danger" size="icon" onClick={onStop} aria-label="Stop">
                  <Square className="size-4" />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="icon"
                  onClick={onSend}
                  disabled={!canSend}
                  aria-label="Send message"
                >
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

// ── Agent mode ────────────────────────────────────────────────────────────────

const AGENT_MODES: { id: AgenticMode; label: string; title: string }[] = [
  { id: "off", label: "Off", title: "Never build — answer in one turn" },
  { id: "auto", label: "Auto", title: "Build when the request calls for it" },
  { id: "always", label: "Build", title: "Always build — workspace, plan, 20 rounds" },
];

/**
 * The Agent control.
 *
 * Replaces a switch buried in the overflow menu, which is where the single most
 * consequential setting in the composer used to live: build mode was off by
 * default, hidden, and its absence was the whole reason "develop this end to
 * end" produced four rounds and an apology.
 *
 * A segment rather than a toggle because there are genuinely three answers, and
 * because the middle one has to be able to *report*. When detection escalates a
 * turn, this fills in and reads `Auto → Build`: the control that made the
 * decision is the control that shows it made one.
 */
function AgentSegment({
  value,
  onChange,
  auto,
}: {
  value: AgenticMode;
  onChange: (mode: AgenticMode) => void;
  auto: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Agent mode"
      className={cn(
        "hidden h-10 shrink-0 items-center gap-0.5 rounded-xl border p-0.5 transition-colors sm:inline-flex",
        auto || value === "always"
          ? "border-accent/40 bg-accent/10"
          : "border-border bg-surface-2/40",
      )}
    >
      {AGENT_MODES.map((m) => {
        // `auto` lights the middle segment as though it were Build, because for
        // this turn it is. The label below says so in words; the fill says it at
        // a glance.
        const active = value === m.id;
        return (
          <Tooltip key={m.id}>
            <TooltipTrigger asChild>
              <button
                role="radio"
                aria-checked={active}
                onClick={() => onChange(m.id)}
                className={cn(
                  "rounded-[0.6rem] px-2 text-2xs font-medium leading-8 transition-colors",
                  active
                    ? m.id === "off"
                      ? "bg-surface-3 text-foreground"
                      : "bg-accent/25 text-accent"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.id === "auto" && auto ? "Auto → Build" : m.label}
              </button>
            </TooltipTrigger>
            <TooltipContent>{m.title}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ── The "+" menu ──────────────────────────────────────────────────────────────

function ComposerMenu({
  webSearch,
  onToggleWeb,
  research,
  onToggleResearch,
  memory,
  onToggleMemory,
  skills,
  skillCount,
  onToggleSkills,
  onOpenSkills,
  github,
  onToggleGithub,
  onOpenGithub,
  codeExecution,
  onToggleCodeExecution,
  connectorCount,
  onOpenConnectors,
  planMode,
  onTogglePlanMode,
  agenticMode,
  onAgenticModeChange,
  incognito,
  onToggleIncognito,
  reasoningEffort,
  onReasoningChange,
  hasProject,
  projectName,
  onOpenProjects,
  onPickFiles,
  canEscalate,
  onEscalate,
}: {
  webSearch: boolean;
  onToggleWeb: () => void;
  research: boolean;
  onToggleResearch?: () => void;
  memory: boolean;
  onToggleMemory: () => void;
  skills: boolean;
  skillCount: number;
  onToggleSkills: () => void;
  onOpenSkills: () => void;
  github: boolean;
  onToggleGithub: () => void;
  onOpenGithub: () => void;
  codeExecution: boolean;
  onToggleCodeExecution: () => void;
  connectorCount: number;
  onOpenConnectors: () => void;
  planMode: boolean;
  onTogglePlanMode: () => void;
  agenticMode: AgenticMode;
  onAgenticModeChange: (mode: AgenticMode) => void;
  incognito: boolean;
  onToggleIncognito: () => void;
  reasoningEffort: ReasoningEffort;
  onReasoningChange: (r: ReasoningEffort) => void;
  hasProject: boolean;
  projectName?: string | null;
  onOpenProjects: () => void;
  onPickFiles: () => void;
  canEscalate?: boolean;
  onEscalate?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Add context and options"
          className="grid size-10 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground data-[state=open]:bg-surface-2 data-[state=open]:text-foreground"
        >
          <Plus className="size-[18px]" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        className="max-h-[min(70vh,32rem)] w-[19rem] overflow-y-auto"
      >
        <DropdownMenuItem onClick={onPickFiles}>
          <Paperclip className="size-4" />
          <span className="flex-1">Attach files</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenProjects}>
          <FolderGit2 className={cn("size-4", hasProject && "!text-action")} />
          <span className="flex-1">Project knowledge</span>
          <span className="max-w-[7rem] truncate text-2xs text-muted-foreground">
            {projectName ?? "None"}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Search &amp; sources</DropdownMenuLabel>

        <DropdownMenuSwitchItem
          icon={<Globe />}
          label="Web search"
          checked={webSearch}
          onCheckedChange={onToggleWeb}
        />
        {/* Distinct from Web search rather than a stronger version of it:
            research runs several differently-framed queries and takes tens of
            seconds, so it is a mode the user chooses, not a default. Absent
            entirely when the flag is off — a switch that does nothing is worse
            than one that is not there. */}
        {onToggleResearch && (
          <DropdownMenuSwitchItem
            icon={<Telescope />}
            label="Research"
            hint="slower"
            checked={research}
            onCheckedChange={onToggleResearch}
          />
        )}
        <DropdownMenuSwitchItem
          icon={<Sparkles />}
          label="Skills"
          hint={skillCount === 0 ? "none installed" : `${skillCount}`}
          checked={skills && skillCount > 0}
          disabled={skillCount === 0}
          onCheckedChange={onToggleSkills}
        />
        <ManageRow onClick={onOpenSkills}>Manage skills…</ManageRow>
        <DropdownMenuSwitchItem
          icon={<Github />}
          label="GitHub"
          hint="read-only"
          checked={github}
          onCheckedChange={onToggleGithub}
        />
        <ManageRow onClick={onOpenGithub}>Configure GitHub access…</ManageRow>
        {/* Off by default only because the interpreter is a ~10MB download from
            a CDN — a cost the user should choose rather than discover. The hint
            names the payoff, since "code execution" undersells what it does:
            real spreadsheets and documents come out of it. */}
        <DropdownMenuSwitchItem
          icon={<Terminal />}
          label="Code execution"
          hint="Python · builds real files"
          checked={codeExecution}
          onCheckedChange={onToggleCodeExecution}
        />
        {/* No on/off switch: connector tools gate themselves on per-call
            approval, so a second switch would imply a control the approval
            prompt already provides. This opens the manager. */}
        <DropdownMenuItem onClick={onOpenConnectors}>
          <Plug className={cn("size-4", connectorCount > 0 && "!text-action")} />
          <span className="flex-1">Connectors</span>
          <span className="text-2xs text-muted-foreground">
            {connectorCount === 0 ? "none" : `${connectorCount} connected`}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>How Atlas runs</DropdownMenuLabel>

        {/* Violet like temporary chat, because plan mode changes how a turn
            runs rather than adding one capability to it. */}
        <DropdownMenuSwitchItem
          icon={<ListChecks />}
          label="Plan mode"
          hint="approve first"
          tone="shelf"
          checked={planMode}
          onCheckedChange={onTogglePlanMode}
        />
        {/* Build mode is the Agent segment in the control row now — it was the
            most consequential setting in this menu and the least discoverable,
            which is why "develop this end to end" produced four rounds and an
            apology. This is the phone fallback, since the segment is `sm:` up. */}
        <DropdownMenuSwitchItem
          icon={<Hammer />}
          label="Always build"
          hint="long builds, costs more"
          tone="shelf"
          checked={agenticMode === "always"}
          onCheckedChange={(on) => onAgenticModeChange(on ? "always" : "auto")}
          className="sm:hidden"
        />
        <DropdownMenuSwitchItem
          icon={<Brain />}
          label="Memory"
          hint="across chats"
          checked={memory}
          onCheckedChange={onToggleMemory}
        />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Zap
              className={cn(
                "size-4",
                reasoningEffort !== "off" ? "text-amber" : "text-muted-foreground",
              )}
            />
            <span className="flex-1">Reasoning effort</span>
            <span className="text-2xs text-muted-foreground">
              {REASONING_LABEL[reasoningEffort]}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <ReasoningLevels value={reasoningEffort} onChange={onReasoningChange} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Session</DropdownMenuLabel>

        <DropdownMenuSwitchItem
          icon={<VenetianMask />}
          label="Temporary chat"
          hint="nothing saved"
          tone="shelf"
          checked={incognito}
          onCheckedChange={onToggleIncognito}
        />
        {canEscalate && onEscalate && (
          <DropdownMenuItem onClick={onEscalate}>
            <ArrowRightFromLine className="size-4" />
            <span className="flex-1">Continue in Atlas Code</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Reasoning effort ──────────────────────────────────────────────────────────

/**
 * The levels themselves, rendered identically whether they were reached from the
 * "+" menu's submenu or from the bar's own control — one list, so the two entry
 * points can never drift apart.
 */
function ReasoningLevels({
  value,
  onChange,
}: {
  value: ReasoningEffort;
  onChange: (r: ReasoningEffort) => void;
}) {
  return (
    <>
      <DropdownMenuRadioGroup
        value={value}
        onValueChange={(v) => onChange(v as ReasoningEffort)}
      >
        {(["off", "low", "medium", "high"] as ReasoningEffort[]).map((r) => (
          <DropdownMenuRadioItem key={r} value={r}>
            {REASONING_LABEL[r]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <p className="px-2.5 pb-1 pt-1.5 text-2xs text-muted-foreground">
        Higher effort means deeper reasoning and more tokens. Works with Claude, o1 and
        Gemini Thinking.
      </p>
    </>
  );
}

/**
 * The bar's reasoning control. It names its own level rather than relying on a
 * tooltip, which is why the matching pill is suppressed wherever this is visible.
 */
export function ReasoningSelector({
  value,
  onChange,
  className,
}: {
  value: ReasoningEffort;
  onChange: (r: ReasoningEffort) => void;
  className?: string;
}) {
  const on = value !== "off";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={on ? `Reasoning effort: ${REASONING_LABEL[value]}` : "Reasoning effort"}
          className={cn(
            "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl transition-colors",
            on ? "bg-amber/15 px-2.5 text-amber" : "w-10 text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            "data-[state=open]:bg-surface-2 data-[state=open]:text-foreground",
            className,
          )}
        >
          <Zap className="size-4" />
          {on && <span className="text-xs font-medium">{REASONING_LABEL[value]}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <ReasoningLevels value={value} onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A quieter row that opens a manager, indented under the switch it belongs to. */
function ManageRow({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className="py-1.5 pl-9 text-xs text-muted-foreground focus:text-foreground"
    >
      {children}
    </DropdownMenuItem>
  );
}

// ── Mode pills ────────────────────────────────────────────────────────────────

const PILL_TONE = {
  ridge: "border-elev-4/30 bg-elev-4/10 text-elev-4 hover:bg-elev-4/15",
  shelf: "border-elev-1/30 bg-elev-1/10 text-elev-1 hover:bg-elev-1/15",
  upland: "border-elev-3/30 bg-elev-3/10 text-elev-3 hover:bg-elev-3/15",
  muted: "border-border bg-surface-2 text-muted-foreground hover:text-foreground",
} as const;

/**
 * Shows one thing that is not default about this turn. `onClear` makes the whole
 * chip the off switch — undoing a mode should never require reopening the menu.
 * `onClick` instead makes it a one-shot action (Summarize), which has nothing to
 * clear and so carries no ×.
 */
function ModePill({
  icon,
  label,
  clearLabel,
  tone = "ridge",
  className,
  onClear,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** What clearing does, when "Turn off {label}" would read wrong. */
  clearLabel?: string;
  tone?: keyof typeof PILL_TONE;
  className?: string;
  onClear?: () => void;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClear ?? onClick}
      aria-label={onClear ? (clearLabel ?? `Turn off ${label}`) : label}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors animate-in fade-in slide-in-from-bottom-1 duration-150",
        PILL_TONE[tone],
        className,
      )}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
      {onClear && <X className="size-3 opacity-60" />}
    </button>
  );
}

// ── Shared icon toggle ────────────────────────────────────────────────────────

export function ComposerToggle({
  children,
  active,
  onClick,
  title,
  label,
  pulse,
  tone = "ridge",
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
  /** Shown next to the icon while active, so the state needs no tooltip. */
  label?: string;
  pulse?: boolean;
  /** Accent when active. Violet marks a mode change, not a per-turn option. */
  tone?: "ridge" | "shelf";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-pressed={active}
          aria-label={title}
          className={cn(
            "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl transition-colors",
            active && label ? "px-2.5" : "w-10",
            active
              ? tone === "shelf"
                ? "bg-accent/15 text-accent"
                : "bg-action/15 text-action"
              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            pulse && "animate-pulse",
          )}
        >
          {children}
          {active && label && (
            <span className="text-xs font-medium">{label}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
