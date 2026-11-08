-- Visitors per day for the web release, from the Cloud Logging → BigQuery sink
-- `dungeon-crawler-requests` (project delimaster, dataset dungeon_crawler_logs).
-- The sink keeps every Cloud Run request log forever (Logging itself keeps 30 days);
-- it started on 2026-09-18; everything Logging still held (from 2026-08-19) was backfilled
-- into the same table that day, so the history is continuous from 2026-08-19.
--
--   bq --project_id=delimaster query --nouse_legacy_sql < tools/traffic/visitors.sql
--
-- A "page load" is a request for the bare root URL; assets are excluded. Distinct
-- client IPs approximate visitors. Headless browsers (our post-deploy smoke checks)
-- are dropped.
SELECT
  DATE(timestamp, 'Europe/Helsinki') AS day,
  COUNT(*) AS page_loads,
  COUNT(DISTINCT httpRequest.remoteIp) AS visitors,
  COUNTIF(REGEXP_CONTAINS(httpRequest.userAgent, r'Mobile|Android|iPhone')) AS mobile_loads,
  COUNTIF(httpRequest.referer LIKE '%reddit%') AS from_reddit
FROM `delimaster.dungeon_crawler_logs.run_googleapis_com_requests`
WHERE REGEXP_CONTAINS(httpRequest.requestUrl, r'^https://[^/]+/(\?.*)?$')
  AND NOT REGEXP_CONTAINS(IFNULL(httpRequest.userAgent, ''), r'Headless')
GROUP BY day
ORDER BY day
