"use client";

// One rendered turn plus its actions (branch stepper, edit, regenerate, pin,
// fork, copy, TTS), split out of chat-client.tsx.

import * as React from "react";
import {
  AlertCircle,
  ArrowRightFromLine,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Code2,
  Copy,
  Download,
  GitFork,
  FileText,
  Image as ImageIcon,
  Pencil,
  Pin,
  RefreshCw,
  Table2,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AtlasMark } from "@/components/brand/logo";
import { Markdown } from "@/components/markdown";
import { ActivityTimeline } from "@/components/chat/activity-timeline";
import { BudgetStop } from "@/components/chat/budget-stop";
import { FileChips } from "@/components/chat/file-chips";
import { buildRun } from "@/lib/chat/run-model";
import { Sources } from "@/components/chat/sources";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { extractArtifact, stripArtifactBlock } from "@/components/chat/artifact-panel";
import { ArtifactCard, ArtifactPatchNote } from "@/components/chat/artifact-card";
import { getModelById, routableModels } from "@/lib/catalog";
import { useChatStore } from "@/lib/store/chat-store";
import { useSettingsStore } from "@/lib/store/settings-store";
import { isEnabled } from "@/lib/store/flags-store";
import { buildEscalationPayload, stashEscalation } from "@/lib/chat/escalate";
import { messageCostUsd, formatUsd } from "@/lib/chat/cost";
import type { useTTS } from "@/lib/hooks/use-speech";
import type { Attachment, ChatMessage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

// ── Message bubble ────────────────────────────────────────────────────────────

// Memoized: while a response streams, the store patches only the last message,
// so every other bubble receives an identical `message` reference and skips
// re-rendering entirely. All callbacks are id-taking and stable by contract —
// keep them that way, or this memo silently stops working.
export const MessageBubble = React.memo(function MessageBubble({
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
  onFork,
  onContinue,
  onOpenSettings,
  conversationId,
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
  onFork?: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  /** Resume a build that stopped at a budget. */
  onContinue?: (id: string) => void;
  onOpenSettings?: () => void;
  /** Needed to read produced files back out of the blob store. */
  conversationId?: string | null;
}) {
  const isUser = message.role === "user";
  // The artifact is shown as a card and previewed in the panel, so its source is
  // lifted out of the transcript rather than printed there. Six hundred lines of
  // markup between two sentences is not something anyone reads in a chat log.
  const artifact = isUser ? null : extractArtifact(message.content);
  const hasArtifact = !!artifact;
  const body = artifact ? stripArtifactBlock(message.content) : message.content;
  // A turn that only patched the artifact has no code in the transcript at all —
  // that is the point of patching — so it needs its own marker or it looks inert.
  const patchedArtifact =
    !isUser && !artifact && !!message.toolCalls?.some((t) => t.name === "artifact");
  // Two kinds of attachment on one field: what the user handed the model, and
  // what the model handed back. Only the second is worth showing at size.
  const generatedImages = (message.attachments ?? []).filter(
    (a) => a.generated && a.kind === "image" && a.dataUrl,
  );
  const attachedChips = (message.attachments ?? []).filter((a) => !a.generated);
  const [copied, setCopied] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(message.content);
  // Selected narrowly: subscribing to the whole settings object would re-render
  // every bubble on any preference change, defeating the memo above.
  const detailedActivity = useSettingsStore((s) => s.detailedActivity);

  const cost =
    !isUser && message.completionTokens != null
      ? message.costUsd ??
        messageCostUsd(
          message.model,
          message.promptTokens,
          message.completionTokens,
          message.imageTokens,
        )
      : 0;

  return (
    <div className={cn("group flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-xl",
          isUser ? "bg-surface-3 text-muted-foreground" : "bg-action text-action-foreground",
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

        {/* Attachments the user added — chips. */}
        {attachedChips.length > 0 && (
          <div className={cn("mb-1.5 flex flex-wrap gap-1.5", isUser && "justify-end")}>
            {attachedChips.map((a) => (
              <AttachmentChip key={a.id} att={a} />
            ))}
          </div>
        )}

        {/* Images the model produced — these *are* the answer, so they are shown
            at size rather than as a chip the user has to open. */}
        {generatedImages.length > 0 && <GeneratedImages images={generatedImages} />}

        {/* Everything the turn did, folded into one collapsed row: thinking,
            each tool call, resumed output, and any runtime error the artifact
            reported. It used to be one bordered card per item, all expanded. */}
        {!isUser && (
          <ActivityTimeline
            reasoning={message.reasoning}
            toolCalls={message.toolCalls}
            continuations={message.continuations}
            truncated={message.truncated}
            artifactErrors={message.artifactErrors}
            capabilityDowngrade={message.capabilityNote}
            streaming={streaming && !message.content}
            defaultOpen={detailedActivity}
          />
        )}

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
              className="w-full resize-none rounded-2xl border border-action/40 bg-surface-2/60 px-4 py-2.5 text-body outline-none"
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
                className="rounded-md bg-action px-2.5 py-1 text-action-foreground"
              >
                Save &amp; submit
              </button>
            </div>
          </div>
        ) : (
          (body || isUser || !streaming || message.error) && (
            <div
              className={cn(
                "text-body",
                // Only the user is in a bubble. An assistant reply used to be
                // carded too, which narrowed the reading measure and made a build
                // answer — already full of cards for its artifact, its files and
                // its activity — read as a card of cards. Putting the reply on
                // the page is the single biggest thing here.
                isUser
                  ? "rounded-2xl bg-surface-3 px-4 py-2.5 text-foreground"
                  : message.error
                    ? "rounded-2xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-danger"
                    : "px-0.5 py-0.5",
              )}
            >
              {message.error ? (
                <span className="flex items-center gap-2 text-sm">
                  <AlertCircle className="size-4" /> {message.content}
                </span>
              ) : isUser ? (
                <p className="whitespace-pre-wrap">{message.content || "​"}</p>
              ) : body ? (
                <Markdown streaming={streaming}>{body}</Markdown>
              ) : (
                // Three dots for forty seconds reads as hung. During an agentic
                // turn the bubble is empty for the whole run, so it says what is
                // happening instead of implying nothing is.
                <LiveStatus message={message} />
              )}
              {streaming && body && (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-caret-blink bg-action align-text-bottom" />
              )}
            </div>
          )
        )}

        {/* What the turn actually produced. A generated spreadsheet that exists
            and cannot be reached is the same outcome as not generating one, so
            it gets the same first-class treatment as a returned image. */}
        {!isUser && conversationId && message.producedFiles?.length ? (
          <FileChips conversationId={conversationId} files={message.producedFiles} />
        ) : null}

        {/* The turn ran out of budget before it ran out of work. A control, not
            a sentence: "ask again to continue" made carrying on something the
            user had to reconstruct and retype, and what they typed restated a
            goal the workspace already knew. */}
        {!isUser && message.stoppedBy && message.stopReason && !streaming && (
          <BudgetStop
            reason={message.stopReason}
            message={message.stoppedBy}
            spentUsd={message.costUsd}
            busy={!canAct}
            onContinue={onContinue ? () => onContinue(message.id) : undefined}
            onOpenSettings={onOpenSettings}
          />
        )}

        {/* The artifact itself: a card here, the source in the panel. */}
        {artifact && !message.error && (
          <ArtifactCard artifact={artifact} onOpen={onOpenArtifact} errorCount={message.artifactErrors?.length ?? 0} />
        )}
        {patchedArtifact && !message.error && <ArtifactPatchNote onOpen={onOpenArtifact} />}

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

        {/* Actions.
            A floating bar rather than a row in the flow: it overlaps the space
            below the turn, so hovering does not shift the message underneath it,
            and it reads as chrome attached to the reply rather than as part of
            the reply. Always visible on touch, where there is no hover to
            trigger it and the row was simply unreachable. */}
        {!editing && (
          <div
            className={cn(
              "mt-1.5 flex w-fit items-center gap-1 rounded-xl border border-border/60 px-1 py-0.5 transition-all sm:-mb-2 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100",
              "glass shadow-lift",
              isUser && "ml-auto flex-row-reverse",
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
                    <ActionBtn onClick={onOpenArtifact} className="text-action">
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
                  {onFork && (
                    <ActionBtn
                      onClick={() => onFork(message.id)}
                      title="Continue in a new conversation from this point"
                    >
                      <GitFork className="size-3.5" /> Fork
                    </ActionBtn>
                  )}
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
                      className="text-accent"
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
export function RegenControl({ onRegenerate }: { onRegenerate: (modelId?: string) => void }) {
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

export function ActionBtn({
  children,
  onClick,
  className,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  /** Hover/AT description when the label alone doesn't explain the action. */
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function AttachmentChip({ att }: { att: Attachment }) {
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
      <Icon className="size-3.5 shrink-0 text-action" />
      <span className="max-w-[10rem] truncate">{att.name}</span>
    </div>
  );
}

/**
 * Images the model generated (§P12).
 *
 * Shown at size, one per row up to two, because the picture is the answer — a
 * 64px chip would be the equivalent of collapsing the reply text. Each carries
 * a download, which is the only way out of the conversation for a data URL.
 *
 * `loading="lazy"` and an explicit `bg` while decoding: a returned image is
 * often a megabyte of base64, and several in one thread would otherwise stall
 * scrolling.
 */
function GeneratedImages({ images }: { images: Attachment[] }) {
  function save(att: Attachment) {
    if (!att.dataUrl) return;
    const a = document.createElement("a");
    a.href = att.dataUrl;
    a.download = att.name;
    a.click();
  }

  return (
    <div
      className={cn(
        "mb-2 grid gap-2",
        images.length > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1",
      )}
    >
      {images.map((att) => (
        <figure
          key={att.id}
          className="group/img relative overflow-hidden rounded-xl border border-border bg-surface-2/40"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={att.dataUrl}
            alt={att.name}
            loading="lazy"
            className="block max-h-[32rem] w-full object-contain"
          />
          <button
            onClick={() => save(att)}
            title="Download image"
            aria-label={`Download ${att.name}`}
            className={cn(
              "absolute right-2 top-2 grid size-11 place-items-center rounded-lg sm:size-8",
              "bg-background/70 text-muted-foreground backdrop-blur-sm transition-colors",
              "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/50",
              // Always present on touch, where there is no hover to reveal it.
              "opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100 sm:focus-visible:opacity-100",
            )}
          >
            <Download className="size-4" />
          </button>
        </figure>
      ))}
    </div>
  );
}

/**
 * What is happening, while an assistant turn has no text yet.
 *
 * Three pulsing dots are fine for the two seconds before a plain reply starts.
 * They are wrong for an agentic turn, where the bubble stays empty for the whole
 * run — often a minute — and a reader has no way to tell a build that is working
 * from one that has wedged. So the dots stay, and a line naming the current step
 * appears beside them as soon as there is one.
 */
function LiveStatus({ message }: { message: ChatMessage }) {
  const headline = React.useMemo(
    () =>
      buildRun({
        toolCalls: message.toolCalls,
        reasoning: message.reasoning,
        streaming: true,
      }).headline,
    [message.toolCalls, message.reasoning],
  );

  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-pulse-dot rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </span>
      {headline && headline !== "Working…" && <span className="min-w-0 truncate">{headline}</span>}
    </span>
  );
}
