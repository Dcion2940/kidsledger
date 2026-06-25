ALTER TABLE app_settings ADD COLUMN telegram_bot_token_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE app_settings ADD COLUMN telegram_chat_id TEXT NOT NULL DEFAULT '';
ALTER TABLE app_settings ADD COLUMN telegram_notify_on_create INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_settings ADD COLUMN telegram_notify_on_start INTEGER NOT NULL DEFAULT 0;
