-- Reverse 0015_news_push.sql.
--
-- Dropping the subscription table is genuinely destructive and not recoverable
-- from a re-subscribe on the server side: a browser that already holds a
-- PushSubscription will not hand it over again unless the user revokes and
-- re-grants permission, so every subscriber goes quiet until they visit /news
-- and opt in a second time. Take a copy first if the intent is a schema change
-- rather than removing the feature.

drop table if exists news_push_runs;
drop table if exists news_push_subscriptions;
