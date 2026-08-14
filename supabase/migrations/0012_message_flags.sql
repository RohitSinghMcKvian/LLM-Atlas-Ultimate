-- LLM Atlas — per-message flags: `pinned` and `folded`.
--
-- `pinned` has been in the UI type since the depth spec and has never been
-- persisted: `lib/chat/repo.ts` carried `if (patch.pinned !== undefined) return;`
-- with the comment "messages.pinned not persisted", so pinning a message worked
-- until the page was reloaded. Recorded as a known defect in GAP-REPORT §8.
--
-- `folded` is new, and it is why this migration exists now. Compaction marks
-- earlier turns folded and stops sending them to the model, substituting one
-- derived summary. That is an *inclusion* flag, not a tree edit — parent links
-- are untouched, so branching is unaffected. But if it did not survive a reload,
-- the folded turns would come back unfolded and the conversation would silently
-- exceed the context window again; and if it survived while the summary did not,
-- those turns would be dropped from the request with nothing in their place.
-- The summary is therefore derived from the flag (`foldedSummary`), which makes
-- this one boolean the only thing that has to persist.
--
-- Both default false, so every existing row is unpinned and unfolded, which is
-- exactly the behaviour before this migration.
--
-- Reverse with 0012_message_flags_down.sql.

alter table messages add column if not exists pinned  boolean not null default false;
alter table messages add column if not exists folded  boolean not null default false;

-- Compaction reads "which messages in this thread are folded" on every send.
-- Partial, because the overwhelming majority of rows are not folded and there is
-- no reason to index them.
create index if not exists messages_folded_idx
  on messages(conversation_id)
  where folded;
