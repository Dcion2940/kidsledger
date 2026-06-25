ALTER TABLE calendar_connections
ADD COLUMN app_user_email TEXT NOT NULL DEFAULT '';

UPDATE calendar_connections
SET app_user_email = LOWER(COALESCE(NULLIF(google_email, ''), app_user_email))
WHERE app_user_email = '';

CREATE INDEX IF NOT EXISTS idx_calendar_connections_app_user_email
ON calendar_connections(app_user_email);
