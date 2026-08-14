-- Reverses 0007_artifacts.sql.
--
-- WARNING: this drops artifact version history and everything artifacts saved
-- via `window.storage`. Unlike the other down-migrations in this directory, it
-- is destructive — the data exists nowhere else server-side. Browser-local
-- copies in IndexedDB are unaffected.

drop table if exists artifact_storage;
drop table if exists artifact_versions;
drop table if exists artifacts;
