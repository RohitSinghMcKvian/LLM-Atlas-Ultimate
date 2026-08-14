"use client";

import { create } from "zustand";
import { chatRepo } from "@/lib/chat/repo";
import { uuid, type ChatMessage, type Conversation } from "@/lib/chat/types";
import {
  emptyTree,
  activePath,
  activeLeafId,
  putNode,
  patchNode,
  selectSibling as selectSiblingPure,
  activeFromLeaf,
  pathTo,
  treeFromList,
  type Tree,
} from "@/lib/chat/tree";
import { clearBranchState, loadBranchState } from "@/lib/chat/branch-state";
import { isIncognito } from "@/lib/chat/incognito";
import { messageCostUsd } from "@/lib/chat/cost";

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || "New chat";
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  /** DAG of turns for the active conversation. */
  tree: Tree;
  /** Derived active path — what the thread renders. */
  messages: ChatMessage[];
  hydrated: boolean;
  remote: boolean;
  /**
   * Per-conversation answer to "should this be a build?", when the user has
   * given one.
   *
   * In memory only, and deliberately. It exists so that declining an auto-build
   * ("Just answer") is not re-asked by the same heuristic three messages later —
   * a session-scoped correction to a session-scoped guess. Persisting it would
   * turn one impatient click into a permanent property of the conversation.
   */
  agenticOverrides: Record<string, boolean>;

  init: () => Promise<void>;
  select: (id: string) => Promise<void>;
  newChat: () => void;
  ensureConversation: (
    firstText: string,
    modelId?: string,
    projectId?: string | null,
  ) => Promise<string>;
  setProject: (conversationId: string, projectId: string | null) => Promise<void>;
  /**
   * Add a turn. If `msg.parentId` is undefined it attaches to the active leaf
   * (normal append); pass an explicit parentId to create a sibling branch
   * (edit / regenerate). Persists when `persist` is true.
   */
  addMessage: (msg: ChatMessage, persist?: boolean) => Promise<void>;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  persistMessage: (id: string) => Promise<void>;
  /**
   * Fold or unfold turns, in memory **and** on disk.
   *
   * Compaction used to go through `patchMessage`, which is in-memory only — so
   * `ChatRepo.updateMessage` had no callers at all and a compacted thread
   * un-compacted itself on reload, sending the full history again and
   * re-triggering the same auto-fold. The whole derived-summary design rests on
   * one boolean per message surviving; this is what makes it survive.
   *
   * One batched write rather than one per message: forty sequential `set()`
   * calls is forty renders of the entire thread.
   */
  foldMessages: (ids: string[], folded: boolean) => Promise<void>;
  /** Pin or unpin a turn, persisted for the same reason folding is. */
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  /** Switch which sibling is shown at a branch point. */
  selectSibling: (id: string) => void;
  /** Remember which branch is being viewed, on the conversation itself. */
  persistActiveLeaf: (conversationId: string) => Promise<void>;
  /** Copy history up to `messageId` into a new conversation. Returns its id. */
  forkConversation: (messageId: string) => Promise<string | null>;
  /**
   * Open a new, empty conversation under a given title, and switch to it.
   *
   * Distinct from `ensureConversation`, which reuses the active conversation and
   * names it after a first message. Remix has no first message — it carries a
   * build across and nothing else — so it needs a conversation that exists
   * before anything is said in it.
   */
  startConversation: (title: string, modelId?: string, projectId?: string | null) => Promise<string>;
  /** Pin this conversation to build or to chat, overriding auto-detection. */
  setAgenticOverride: (conversationId: string, build: boolean | null) => void;
  /** Discard in-memory-only conversations created in incognito. */
  dropTemporary: () => void;
  rename: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const repo = () => chatRepo();

function bumpConversation(list: Conversation[], id: string): Conversation[] {
  const now = Date.now();
  return list
    .map((c) => (c.id === id ? { ...c, updatedAt: now } : c))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/** Fold in a derived cost once tokens are known (kept alongside the node). */
function withCost(msg: ChatMessage): ChatMessage {
  if (
    msg.role === "assistant" &&
    msg.completionTokens != null &&
    msg.costUsd == null
  ) {
    return {
      ...msg,
      costUsd: messageCostUsd(
        msg.model,
        msg.promptTokens,
        msg.completionTokens,
        msg.imageTokens,
      ),
    };
  }
  return msg;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  tree: emptyTree(),
  messages: [],
  hydrated: false,
  remote: false,
  agenticOverrides: {},

  async init() {
    if (get().hydrated) return;
    try {
      const conversations = await (await repo()).listConversations();
      const remote = (await repo()).remote;
      set({
        conversations: conversations.sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
        ),
        hydrated: true,
        remote,
      });
      // Collect builds whose conversation is gone: the ones left by every delete
      // before the cascade existed, and by every temporary chat before P16 gated
      // artifact writes.
      //
      // `authoritative` is only claimed for the local drivers, where the list
      // just read is complete by construction. The remote driver's
      // `listConversations()` sets no limit and PostgREST caps rows server-side,
      // so a long list can come back truncated with no error — and this sweep
      // deletes on the strength of an absence. Never from a list that might be
      // short. Fire-and-forget: nothing on screen waits for it.
      void import("@/lib/chat/artifact-gc")
        .then((m) =>
          m.sweepOrphanedBuilds(
            conversations.map((c) => c.id),
            { authoritative: !remote && !isIncognito() },
          ),
        )
        .catch(() => {});
    } catch (e) {
      console.warn("[chat] failed to load conversations", e);
      set({ hydrated: true, remote: (await repo()).remote });
    }
  },

  async select(id) {
    if (get().activeId === id) return;
    set({ activeId: id, tree: emptyTree(), messages: [] });
    try {
      const list = await (await repo()).listMessages(id);
      if (get().activeId !== id) return; // switched again mid-load
      const base = treeFromList(list);
      // The persisted leaf is authoritative and syncs across devices. The old
      // localStorage pointer map is still honoured as a fallback so a user who
      // upgrades mid-conversation doesn't get bounced to another branch.
      const stored = get().conversations.find((c) => c.id === id)?.activeLeafId;
      const fromLeaf = activeFromLeaf(base.nodes, stored);
      const tree: Tree = {
        ...base,
        active: Object.keys(fromLeaf).length ? fromLeaf : loadBranchState(id),
      };
      set({ tree, messages: activePath(tree) });
    } catch (e) {
      console.warn("[chat] failed to load messages", e);
    }
  },

  newChat() {
    set({ activeId: null, tree: emptyTree(), messages: [] });
  },

  async ensureConversation(firstText, modelId, projectId) {
    const existing = get().activeId;
    if (existing) return existing;
    const id = uuid();
    const now = Date.now();
    const conv: Conversation = {
      id,
      title: titleFrom(firstText),
      modelId,
      projectId: projectId ?? null,
      // Marked so the history rail can hide it and leaving incognito can discard
      // it. The repo write below is a no-op in incognito (see repo-private.ts);
      // this flag is only about what the UI does with the in-memory copy.
      ...(isIncognito() ? { temporary: true } : {}),
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ conversations: [conv, ...s.conversations], activeId: id }));
    try {
      await (await repo()).createConversation({ id, title: conv.title, modelId, projectId });
    } catch (e) {
      console.warn("[chat] failed to create conversation", e);
    }
    return id;
  },

  async startConversation(title, modelId, projectId) {
    const id = uuid();
    const now = Date.now();
    const conv: Conversation = {
      id,
      title,
      modelId,
      projectId: projectId ?? null,
      // Same flag and same reason as `ensureConversation`: the repo write below
      // is already a no-op in incognito, this is only about what the rail does
      // with the in-memory copy.
      ...(isIncognito() ? { temporary: true } : {}),
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeId: id,
      tree: emptyTree(),
      messages: [],
    }));
    try {
      await (await repo()).createConversation({ id, title, modelId, projectId });
    } catch (e) {
      console.warn("[chat] failed to start conversation", e);
    }
    return id;
  },

  async setProject(conversationId, projectId) {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, projectId } : c,
      ),
    }));
    try {
      await (await repo()).updateConversation(conversationId, { projectId });
    } catch (e) {
      console.warn("[chat] failed to set project", e);
    }
  },

  async addMessage(msg, persist = false) {
    const node = withCost(
      msg.parentId === undefined ? { ...msg, parentId: activeLeafId(get().tree) } : msg,
    );
    set((s) => {
      const tree = putNode(s.tree, node);
      return { tree, messages: activePath(tree) };
    });
    const convId = get().activeId;
    if (convId) void get().persistActiveLeaf(convId);
    if (persist && convId) {
      try {
        await (await repo()).addMessage(convId, node);
        set((s) => ({ conversations: bumpConversation(s.conversations, convId) }));
      } catch (e) {
        console.warn("[chat] failed to persist message", e);
      }
    }
  },

  patchMessage(id, patch) {
    set((s) => {
      const cur = s.tree.nodes[id];
      if (!cur) return s;
      const merged = withCost({ ...cur, ...patch });
      const tree = patchNode(s.tree, id, merged);

      // `patchNode` only replaces one node's content — it never changes the
      // DAG's shape or the `active` pointers, so re-walking the whole tree
      // would provably return the same sequence of ids. Splicing the one
      // changed entry instead keeps every *other* ChatMessage's object
      // identity stable across a streaming flush, which is what lets the
      // memoized MessageBubble skip re-rendering all the messages that did
      // not change. This runs ~20x/second while a response streams.
      const idx = s.messages.findIndex((m) => m.id === id);
      const messages =
        idx === -1
          ? // Patched node isn't on the visible path (a background branch).
            // Fall back to the full walk so behaviour is unchanged.
            activePath(tree)
          : s.messages.map((m, i) => (i === idx ? merged : m));

      return { tree, messages };
    });
  },

  async persistMessage(id) {
    const convId = get().activeId;
    const msg = get().tree.nodes[id];
    if (!convId || !msg) return;
    try {
      await (await repo()).addMessage(convId, msg);
      set((s) => ({ conversations: bumpConversation(s.conversations, convId) }));
    } catch (e) {
      console.warn("[chat] failed to persist message", e);
    }
  },

  async foldMessages(ids, folded) {
    const convId = get().activeId;
    if (!convId || !ids.length) return;

    // Memory first, in one `set`. The UI must not wait on IndexedDB to show a
    // fold the user just asked for, and forty separate updates would be forty
    // renders of the whole thread.
    set((s) => {
      let tree = s.tree;
      for (const id of ids) {
        const cur = tree.nodes[id];
        if (cur) tree = patchNode(tree, id, { ...cur, folded });
      }
      return { tree, messages: activePath(tree) };
    });

    try {
      await (await repo()).updateMessages(
        convId,
        ids.map((id) => ({ id, patch: { folded } })),
      );
    } catch (e) {
      // The fold still holds for this session. Worth saying, because the thing
      // that silently failed is precisely durability.
      console.warn("[chat] failed to persist fold", e);
    }
  },

  async setPinned(id, pinned) {
    const convId = get().activeId;
    if (!convId) return;
    get().patchMessage(id, { pinned });
    try {
      await (await repo()).updateMessage(convId, id, { pinned });
    } catch (e) {
      console.warn("[chat] failed to persist pin", e);
    }
  },

  selectSibling(id) {
    set((s) => {
      const active = selectSiblingPure(s.tree, id);
      const tree: Tree = { ...s.tree, active };
      return { tree, messages: activePath(tree) };
    });
    const convId = get().activeId;
    if (convId) void get().persistActiveLeaf(convId);
  },

  /**
   * Save which branch is being viewed, as the id of its last message.
   *
   * Fire-and-forget: this is a UI hint, and a failed write should never
   * interrupt the conversation. Skipped when the leaf hasn't actually moved, so
   * streaming a reply doesn't issue a write per token flush.
   */
  async persistActiveLeaf(conversationId) {
    const leaf = activeLeafId(get().tree);
    const current = get().conversations.find((c) => c.id === conversationId);
    if (!current || current.activeLeafId === leaf) return;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, activeLeafId: leaf } : c,
      ),
    }));
    try {
      await (await repo()).updateConversation(conversationId, { activeLeafId: leaf });
    } catch {
      /* branch memory is a nicety; never surface this */
    }
  },

  /**
   * Copy the conversation up to and including `messageId` into a new one.
   *
   * Distinct from a sibling branch: branches live inside one conversation and
   * share its history, while a fork is a separate thread that can diverge
   * without cluttering the original. Ids are regenerated so the two never share
   * message rows.
   */
  async forkConversation(messageId) {
    const { tree, activeId, conversations } = get();
    const prefix = pathTo(tree.nodes, messageId);
    if (prefix.length === 0) return null;

    const source = conversations.find((c) => c.id === activeId);
    const newId = uuid();
    const now = Date.now();
    const title = `${source?.title ?? titleFrom(prefix[0].content)} (fork)`;

    // Rewrite parent links onto the new ids as we copy.
    const idMap = new Map<string, string>();
    const copies: ChatMessage[] = prefix.map((m, i) => {
      const id = uuid();
      idMap.set(m.id, id);
      return {
        ...m,
        id,
        parentId: i === 0 ? null : (idMap.get(m.parentId ?? "") ?? null),
        createdAt: now + i,
      };
    });

    const conv: Conversation = {
      id: newId,
      title,
      modelId: source?.modelId,
      projectId: source?.projectId ?? null,
      activeLeafId: copies[copies.length - 1].id,
      createdAt: now,
      updatedAt: now,
    };

    set((s) => ({ conversations: [conv, ...s.conversations] }));
    try {
      const r = await repo();
      await r.createConversation({
        id: newId,
        title,
        modelId: source?.modelId,
        projectId: source?.projectId ?? null,
      });
      for (const m of copies) await r.addMessage(newId, m);
      await r.updateConversation(newId, { activeLeafId: conv.activeLeafId });
    } catch (e) {
      console.warn("[chat] failed to fork conversation", e);
    }

    const forked = treeFromList(copies);
    set({
      activeId: newId,
      tree: forked,
      messages: activePath(forked),
    });
    return newId;
  },

  /**
   * Pin a conversation to build or to chat.
   *
   * `null` hands it back to auto-detection, which is what the composer's Agent
   * control does when the user moves it off an explicit choice.
   */
  setAgenticOverride(conversationId, build) {
    set((s) => {
      if (build === null) {
        const { [conversationId]: _drop, ...rest } = s.agenticOverrides;
        return { agenticOverrides: rest };
      }
      return { agenticOverrides: { ...s.agenticOverrides, [conversationId]: build } };
    });
  },

  /**
   * Forget every temporary conversation.
   *
   * Called when incognito is toggled in either direction. Nothing to delete from
   * storage — they were never written — so this is a pure in-memory drop, and it
   * is what makes "this conversation disappears when you leave it" true rather
   * than merely hidden.
   */
  dropTemporary() {
    set((s) => {
      const conversations = s.conversations.filter((c) => !c.temporary);
      const activeGone =
        s.activeId != null && !conversations.some((c) => c.id === s.activeId);
      return activeGone
        ? { conversations, activeId: null, tree: emptyTree(), messages: [] }
        : { conversations };
    });
  },

  async rename(id, title) {
    const clean = title.trim() || "Untitled";
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title: clean } : c,
      ),
    }));
    try {
      await (await repo()).updateConversation(id, { title: clean });
    } catch (e) {
      console.warn("[chat] failed to rename", e);
    }
  },

  async togglePin(id) {
    const conv = get().conversations.find((c) => c.id === id);
    if (!conv) return;
    const pinned = !conv.pinned;
    set((s) => ({
      conversations: s.conversations
        .map((c) => (c.id === id ? { ...c, pinned } : c))
        .sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
        ),
    }));
    try {
      await (await repo()).updateConversation(id, { pinned });
    } catch (e) {
      console.warn("[chat] failed to pin", e);
    }
  },

  async remove(id) {
    const wasActive = get().activeId === id;
    clearBranchState(id);
    // Drop the past-chat search index too. A deleted conversation that still
    // turned up in `search_past_chats` would be a deletion that didn't delete.
    // Fire-and-forget and dynamically imported so this store stays free of the
    // IndexedDB layer, matching how projects-store drops its RAG index.
    void import("@/lib/chat/chat-index")
      .then((m) => m.clearConversationIndex(id))
      .catch(() => {});
    // And the build. Artifacts, their version history, their `window.storage`
    // rows and the `/workspace` filesystem are all keyed by conversation id and
    // all outlived the conversation — the same "deletion that didn't delete"
    // the line above exists to prevent.
    void import("@/lib/chat/artifact-gc")
      .then((m) => m.deleteBuild(id))
      .catch(() => {});
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      ...(wasActive ? { activeId: null, tree: emptyTree(), messages: [] } : {}),
    }));
    try {
      await (await repo()).deleteConversation(id);
    } catch (e) {
      console.warn("[chat] failed to delete", e);
    }
  },
}));
