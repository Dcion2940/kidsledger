DELETE FROM calendar_connections
WHERE app_user_email <> ''
  AND rowid NOT IN (
    SELECT rowid
    FROM (
      SELECT
        rowid,
        ROW_NUMBER() OVER (
          PARTITION BY app_user_email
          ORDER BY updated_at DESC, created_at DESC, id DESC
        ) AS rn
      FROM calendar_connections
      WHERE app_user_email <> ''
    )
    WHERE rn = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_connections_app_user_email_unique
ON calendar_connections(app_user_email)
WHERE app_user_email <> '';
