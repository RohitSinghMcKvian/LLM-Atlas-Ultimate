-- Reverse of 0013_multi_artifact.sql.
--
-- This one cannot be a plain mirror image, and getting it wrong would make the
-- rollback fail exactly when it is needed most.
--
-- Going forward is safe: every conversation had at most one artifact, so adding
-- `path` and re-uniquing on (conversation_id, path) can never conflict. Going
-- BACK is not, because by then conversations may hold several artifacts, and
-- restoring `artifacts_conversation_uniq` against a table with two rows sharing
-- a conversation_id raises a unique violation and aborts the migration.
--
-- So the extra rows have to go first. The rule below keeps the most recently
-- updated artifact per conversation and deletes the rest; `artifact_versions`
-- and `artifact_storage` cascade with them. That IS destructive — it is a
-- rollback of a feature whose whole content is "more than one artifact", and
-- there is nowhere for the extras to go in the old schema. Take a backup first
-- if any conversation has used multi-file builds.

delete from artifacts a
using artifacts b
where a.conversation_id = b.conversation_id
  and (
    a.updated_at < b.updated_at
    -- Deterministic tie-break, so two rows updated in the same transaction do
    -- not both survive (or both vanish).
    or (a.updated_at = b.updated_at and a.id < b.id)
  );

drop index if exists artifacts_conversation_path_uniq;
alter table artifacts drop column if exists path;
create unique index if not exists artifacts_conversation_uniq on artifacts(conversation_id);
