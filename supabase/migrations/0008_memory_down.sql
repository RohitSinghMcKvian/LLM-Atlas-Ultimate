-- Reverse 0008_memory.sql.
--
-- DESTRUCTIVE: dropping these tables discards every memory file and the user's
-- memory summary. There is no archival copy on the server. Browser-local memory
-- in IndexedDB is unaffected — which, while sync remains unbuilt, is where all
-- of it actually lives today.

drop trigger if exists memory_files_touch on memory_files;
drop trigger if exists memory_profile_touch on memory_profile;

drop table if exists memory_files;
drop table if exists memory_profile;
