# iPhone Shortcut Calendar Create

This project includes a shortcut-friendly event create endpoint that can accept both a clean JSON payload and a legacy nested shortcut payload.

## Runtime Secret

Pages secret required:

- `CALENDAR_SHORTCUT_SECRET`

## API

- `POST /api/calendar/shortcut-create`

Headers:

- `x-calendar-shortcut-secret`

Body:

- `appUserEmail`
- `title`
- `date`
- `startTime`
- `endTime`
- or `timeRange` with values like `09:00-10:00` or `全天`
- optional `location`
- optional `description`
- optional `allDay`
- optional `autoRolloverEnabled`

Supported compatibility input:

- `title` may also be passed as `事件標題 / 09:00-10:00`
- legacy nested shortcut payloads under `properties` are also accepted
- if `任務等級` includes `重要`, the API treats it as `autoRolloverEnabled=true`
- if a legacy shortcut only provides `執行日期` without a time, the event is created as an all-day event

## Current packaging status

The repo still contains an experimental generator script under:

- `scripts/generate_kidsledger_shortcut.py`

But the reliable import artifact is currently being built through the macOS Shortcuts app flow rather than the plist generator, because Apple shortcut packaging is stricter than a plain plist export.
