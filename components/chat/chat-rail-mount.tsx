"use client";

import * as React from "react";
import { ChatRail, type RailTab } from "@/components/chat/chat-rail";
import type { ArtifactFile } from "@/components/chat/artifact-panel";
import type { ProducedFile } from "@/components/chat/file-chips";
import type { StoredToolCall } from "@/lib/chat/types";
import type { WorkspaceSnapshot } from "@/lib/chat/workspace/types";

/**
 * One memoized mount for the rail, rendered at both the desktop aside and the
 * mobile sheet.
 *
 * This replaces a `railProps` object built in a `useMemo`. That memo existed for
 * exactly one reason — two mount points that must not drift — and it could not
 * possibly work: an object literal is a new identity every time any dependency
 * changes, and its dependencies included the message list, which `patchMessage`
 * replaces every 48ms while streaming. So the whole rail, plus a full artifact
 * regex scan of the thread, rebuilt twenty times a second for the entire run.
 *
 * A component solves the drift problem the memo was for *and* gets shallow prop
 * comparison, which an object-in-a-memo never had. Every prop below is a
 * primitive, a stable callback, or an array whose identity genuinely tracks its
 * contents — so a content flush no longer reaches the rail at all.
 */
export interface ChatRailMountProps {
  tab: RailTab;
  onTabChange: (tab: RailTab) => void;
  onClose: () => void;

  /**
   * The run, as fields rather than as a `RunInput` object.
   *
   * Passing the object would reintroduce exactly the identity churn this
   * component exists to remove, and would defeat `RunPanel`'s own `buildRun`
   * memo — which is why that memo never hit.
   */
  toolCalls?: StoredToolCall[];
  reasoning?: string;
  progress: Record<string, string>;
  streaming: boolean;
  rounds: number;
  maxRounds: number;
  spentUsd: number;
  maxUsd: number;
  /** Characters on the wire this round, after trimming. 0 between turns. */
  contextChars: number;
  /** The model's window, in tokens. Absent hides the meter. */
  contextWindow?: number;
  elapsedMs: number;
  runSummary?: string;
  onStop: () => void;

  /**
   * A budget stop, as data rather than as a rendered element.
   *
   * An element is a new object every render and would defeat the memo on the
   * first prop compare. `RunPanel` builds the strip itself, from the same
   * `BudgetStop` component the transcript uses — so the rail and the bubble
   * offer the same control from the same facts.
   */
  stop?: { reason: string; message: string; spentUsd?: number };
  onContinueRun?: () => void;
  onOpenSettings?: () => void;

  workspace: WorkspaceSnapshot;
  conversationId: string | null;
  produced: ProducedFile[];

  artifactFiles: ArtifactFile[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  artifactId: string | null;
  onRevert: (versionNumber: number) => void;
  onFix: (errors: string[]) => void;
  onErrors: (errors: string[]) => void;
  onRemix: () => void;
  onEditArtifact: (instruction: string) => void;
  onOpenWorkspaceFile: (path: string) => void;
}

export const ChatRailMount = React.memo(function ChatRailMount(props: ChatRailMountProps) {
  return <ChatRail {...props} />;
});
