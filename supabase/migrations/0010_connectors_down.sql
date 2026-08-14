-- Reverse 0010_connectors.sql.
--
-- DESTRUCTIVE: drops every connector, including its sealed tokens. Those tokens
-- are unrecoverable from the server side by design — they are encrypted under a
-- key that never left the user's browser — so reconnecting each service is the
-- only way back. Browser-local connectors in IndexedDB are unaffected, which
-- while sync remains unbuilt is where all of them actually live.

drop trigger if exists connectors_touch on connectors;
drop table if exists connectors;
