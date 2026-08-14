-- Reverse 0011_profiles_roles.sql.
--
-- DESTRUCTIVE: drops every profile, and with them every role assignment. The
-- accounts themselves survive in auth.users — only display identity and the
-- admin grants are lost, and re-running 0011 rebuilds the rows from
-- raw_user_meta_data. Roles are the part that cannot be recovered, so record
-- who was an admin before running this.

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

drop trigger if exists profiles_pin_role on profiles;
drop trigger if exists profiles_touch on profiles;

drop table if exists profiles;

-- Dropped after the table: the policies above depend on it.
drop function if exists is_admin();
drop function if exists pin_profile_role();
