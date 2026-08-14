-- LLM Atlas — remember which branch of a conversation the user was reading.
--
-- A conversation is a DAG (edits and regenerations create sibling branches, see
-- lib/chat/tree.ts). Until now the chosen branch lived only in this browser's
-- localStorage, so opening the same conversation on another device silently
-- dropped you onto the newest branch instead of the one you were reading.
--
-- Storing one leaf id is enough to rebuild the whole visible path: walking
-- parent links up from it names exactly one child at every level
-- (`activeFromLeaf`). A single id also syncs cleanly, where the full
-- parent→child pointer map would need conflict resolution.
--
-- Nullable on purpose: absent means "no branch chosen yet", and the UI falls
-- back to the newest child, which is the same behaviour as before this column.
--
-- Reverse with 0006_active_leaf_down.sql.

alter table conversations
  add column if not exists active_leaf_message_id uuid;

-- No FK to messages(id): the leaf is a hint, not a constraint. A dangling id
-- (message deleted, branch pruned) must degrade to "newest child" rather than
-- block the delete or fail the write. `activeFromLeaf` already ignores unknown
-- ids, so the fallback is automatic.

comment on column conversations.active_leaf_message_id is
  'Last message on the branch the user was viewing. Hint only — unresolvable ids fall back to the newest child.';
