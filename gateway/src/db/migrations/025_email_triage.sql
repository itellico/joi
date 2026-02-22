-- Email inbox triage: cron job to poll Gmail accounts for new emails
INSERT INTO cron_jobs (agent_id, name, description, schedule_kind, schedule_cron_expr,
   schedule_cron_tz, session_target, payload_kind, payload_text, enabled)
VALUES ('personal', 'scan_email_inboxes', 'Scan Gmail inboxes for new emails and triage',
   'cron', '*/15 * * * *', 'Europe/Vienna', 'isolated', 'system_event',
   'scan_email_inboxes', true)
ON CONFLICT (name) DO NOTHING;
