-- Reverse of 0012_message_flags.sql.
--
-- Dropping `folded` un-folds every conversation that had been compacted, which
-- is the safe direction: those threads become long again rather than losing
-- turns. Nothing else depends on either column.

drop index if exists messages_folded_idx;
alter table messages drop column if exists folded;
alter table messages drop column if exists pinned;
