-- Reverse 0009_skills.sql.
--
-- DESTRUCTIVE: drops every installed skill, including ones the user wrote.
-- Browser-local skills in IndexedDB are unaffected — which, while sync remains
-- unbuilt, is where all of them actually live.

drop trigger if exists skills_touch on skills;
drop table if exists skills;
