-- Reverses 0006_active_leaf.sql.
--
-- Dropping this column loses only which branch each conversation was last read
-- at; no messages are affected. The UI falls back to "newest child", which is
-- what it did before 0006.

alter table conversations
  drop column if exists active_leaf_message_id;
