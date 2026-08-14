-- LLM Atlas — several artifacts per conversation, addressed by path.
--
-- 0007 created `artifacts` with a unique index on `conversation_id` and said so
-- outright:
--
--     Identity: ONE artifact per conversation, matching the panel's UX of a
--     single evolving document. Claude supports several distinct artifacts per
--     conversation; Atlas does not yet. Recorded as a known gap, not designed
--     out — dropping the unique constraint below is all this schema needs to
--     allow it.
--
-- This is that change. It matters more than it sounds: with one artifact per
-- conversation, a second deliverable became *version N+1 of the first*, so a
-- landing page plus its stylesheet, a multi-screen app, or a report alongside a
-- deck could not be represented at all.
--
-- Identity is now (conversation_id, path). Version history is unchanged and
-- stays per-artifact, so each file keeps its own history and its own revert.
--
-- `artifact_storage` is untouched. It is keyed by `artifact_id`, and the backfill
-- below preserves every existing id, so a page that had saved state through
-- `window.storage` still finds it.
--
-- Reverse with 0013_multi_artifact_down.sql — read the note there first.

alter table artifacts add column if not exists path text not null default 'index.html';

-- Existing rows all become the conversation's entry document, which is exactly
-- what they were. `default` above already applied it; this is belt and braces
-- for a row that somehow carried an empty string.
update artifacts set path = 'index.html' where path is null or path = '';

drop index if exists artifacts_conversation_uniq;

create unique index if not exists artifacts_conversation_path_uniq
  on artifacts(conversation_id, path);
