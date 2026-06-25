---
title: KidsLedger
aliases:
  - KidsLedger Home
type: guide
date: 2026-05-12
updated: 2026-06-20
tags: [kidsledger, project, index]
status: active
---

# KidsLedger

KidsLedger is a shared family ledger built with React, Vite, Cloudflare Pages Functions, and D1.

## Project Baseline

This repo has been retrofitted with a safer project baseline without re-running a destructive scaffold.

- Architecture notes: [docs/architecture.md](docs/architecture.md)
- Development workflow: [docs/development-workflow.md](docs/development-workflow.md)
- Release checklist: [docs/release-checklist.md](docs/release-checklist.md)
- Migration notes: [migrations/README.md](migrations/README.md)

Obsidian project cockpit:

- [KidsLedger/專案工作流程.md](/Users/milo/Library/CloudStorage/OneDrive-Personal/Secondbrain/KidsLedger/專案工作流程.md)

Boundary note:

- `Sales_SOP_Assistants/` is not part of KidsLedger
- KidsLedger tooling now excludes it from typecheck and normal repo hygiene on purpose

## Current Product Status

### Investments: TW + US

In progress and locally implemented:

- investments now support both Taiwan stocks and US stocks
- investment records can store:
  - `market`
  - `tradeCurrency`
  - `fxRateToTwd`
  - `feeAmount`
  - `netAmountTwd`
- US stock trades currently assume:
  - broker default: `玉山證券`
  - order channel default: `電子下單`
  - trade FX can be auto-filled from the current USD/TWD reference rate and then manually adjusted
- investment summary cards use:
  - `目前可用資金`
  - `已實現損益（台幣）`
  - `未實現損益（台幣）`
- US stock original-currency PnL is shown only as supporting information

### FX Reference Rate

Implemented:

- a server-side `USD/TWD` reference rate endpoint:
  - `GET /api/fx/usd-twd`
- the endpoint fetches from Frankfurter:
  - no API key required
  - intended only for valuation reference, not broker-grade settlement accuracy
- the fetched rate is cached into `app_settings`
- the frontend reads the cached value and uses it for:
  - pre-filling US stock trade FX
  - estimating current TWD valuation for held US stocks

Important boundary:

- this is a valuation reference rate
- it is not the actual E.SUN settlement FX rate
- the user can still manually correct the FX on each trade

### Phase 1: App Lock

Completed:

- Google sign-in entry flow
- D1-backed children, transactions, investments, prices, and settings
- Site-wide lock screen
- Lock on first entry
- Automatic re-lock after idle timeout
- Password unlock via Cloudflare Function and `APP_LOCK_KEY`
- Configurable idle timeout in settings
- Child name editing in settings

### Phase 2: Passkey / Face ID

Started:

- D1 schema for passkeys and WebAuthn challenges
- API skeleton for passkey registration and authentication options
- Registration verification for WebAuthn create flow
- Authentication verification still scaffolded as explicit `501` placeholder until assertion verification is implemented

Reference:

- [Passkey phase plan](docs/app-lock-phase2-passkey-plan.md)

## Tech Stack

- React 19
- Vite 6
- Cloudflare Pages
- Cloudflare Functions
- Cloudflare D1
- Google OAuth for sign-in

## Local Development

Prerequisites:

- Node.js
- Node 20 or newer is recommended
- Wrangler CLI access if you want to run D1 migrations or deploy manually

Create [.env.local](/Users/milo/Downloads/kidsledger/.env.local):

```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GEMINI_API_KEY=optional_or_placeholder
```

Google OAuth authorized JavaScript origins should include at least:

- `http://localhost:3000`
- `https://kidsledger.pages.dev`

Run locally:

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

Typecheck scope:

- `npm run typecheck` currently covers the frontend app and shared browser-side code
- Cloudflare Functions and Workers are intentionally kept out of the default typecheck until their runtime-specific typing is standardized

## Deployment

### Cloudflare Pages

Required runtime pieces:

- D1 database bound as `DB`
- Pages secret: `APP_LOCK_KEY`

Optional runtime pieces:

- `APP_LOCK_RP_ID`
  Use this in Phase 2 if you want to force a stable WebAuthn RP ID instead of deriving it from the request host.
- `APP_LOCK_RP_NAME`
  Optional friendly RP name for Passkey registration options.
- `APP_LOCK_SESSION_SECRET`
  Required once `auth/verify` is used to issue signed short-lived unlock tokens.
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
  Required for the upcoming Google Calendar connection flow.
- `GOOGLE_CALENDAR_TOKEN_SECRET`
  Required to encrypt the stored Google Calendar refresh token inside D1.
- `OPENAI_API_KEY`
  Required for financial advice and calendar AI assistant features.
- `TELEGRAM_TOKEN_SECRET`
  Optional. If omitted, Telegram bot tokens will be encrypted with `GOOGLE_CALENDAR_TOKEN_SECRET`.
- `TELEGRAM_JOB_SECRET`
  Required if you want to trigger the due-job processing endpoint securely from an external cron.
- `CALENDAR_ROLLOVER_SECRET`
  Optional if you still want to trigger the rollover API endpoint manually. Not required for the dedicated cron worker.
- `CALENDAR_SHORTCUT_SECRET`
  Required if you want to let an iPhone Shortcut create calendar events through the dedicated shortcut API.
- `PRICE_SYNC_KEY`
  Required if you want to write stock prices into the D1 `prices` table through `/api/prices/bulk-upsert`.
- `PRICE_SYNC_TRIGGER_URL`
  Required if you want the in-app settings button to trigger the stock price sync worker from the Pages app.

### Manual Deploy Flow

1. Apply D1 migrations.
2. Build the app.
3. Deploy `dist` to Cloudflare Pages.

Example:

```bash
npx wrangler d1 execute kidsledger-db --remote --file migrations/0005_add_idle_lock_to_settings.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0006_create_app_lock_passkeys.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0007_create_family_cash_records.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0008_create_calendar_connections.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0009_create_calendar_members.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0010_create_calendar_action_logs.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0011_add_app_user_email_to_calendar_connections.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0012_add_telegram_settings.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0013_create_calendar_notification_jobs.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0014_create_calendar_event_workflow.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0017_add_multi_market_investments.sql
npx wrangler d1 execute kidsledger-db --remote --file migrations/0018_add_fx_reference_to_settings.sql
npm run build
npx wrangler pages deploy dist --project-name kidsledger --branch main
```

### Midnight Calendar Rollover

The main Pages app now supports event workflow state, but the actual midnight rollover should run from a dedicated Worker cron that calls the Pages rollover API.

Files:

- `workers/calendar-rollover-cron.ts`
- `wrangler.rollover.toml`

Cron schedule:

- `0 16 * * *`
  This is `00:00` in `Asia/Taipei`, because Cloudflare cron uses UTC.

One-time deploy command:

```bash
npx wrangler deploy -c wrangler.rollover.toml
```

Required runtime pieces for the cron worker:

- `CALENDAR_ROLLOVER_SECRET`
- `ROLLOVER_API_URL`

Required runtime pieces for the Pages app rollover API:

- `CALENDAR_ROLLOVER_SECRET`
- existing Google Calendar secrets already used by the Pages app

What it does:

- cron worker calls the secured Pages rollover endpoint
- the Pages app scans events marked `未完成自動順延`
- skips events already confirmed
- skips recurring events
- moves qualifying events to the next day at the same time
- updates Telegram start reminder jobs
- sends a Telegram update notification for the rollover

Fast validation:

- You can manually call the cron worker in dry-run mode:

```bash
curl "https://kidsledger-calendar-rollover.dcion2940.workers.dev?targetDate=2026-04-06&dryRun=1"
```

- `targetDate` means “treat this date as yesterday”.
- `dryRun=1` means it will not actually move the event; it only returns diagnostics.
- Remove `dryRun=1` to execute the rollover immediately for testing.

### Scheduled Stock Price Sync

The repo now includes a dedicated Worker cron for updating stock prices from Yahoo Finance into the Pages `prices` API.

Files:

- `workers/price-sync-cron.ts`
- `wrangler.price-sync.toml`

Assumptions:

- each `prices.symbol` is already stored in Yahoo format, for example `2330.TW` or `6488.TWO`
- the Pages app has `PRICE_SYNC_KEY` configured

Cron schedule:

- `0,10,20,30,40,50 1-5 * * MON-FRI`
- `0 6 * * MON-FRI`

These two cron expressions equal `09:00-14:00` every 10 minutes in `Asia/Taipei`, because Cloudflare cron uses UTC.

What it does:

- skips weekends
- skips times outside `09:00-14:00` in `Asia/Taipei`
- checks the official TWSE holiday schedule and skips market holidays
- reads current symbols from `GET /api/prices`
- fetches Yahoo quotes in batches
- writes valid quotes back through `POST /api/prices/bulk-upsert`

Current limitation:

- this worker is still TW-market-centric
- it assumes Taiwan market hours and TWSE holiday logic
- if US stock coverage is expanded further, treat TW prices, US prices, and FX reference updates as separate schedules instead of forcing them into one cron policy

Required runtime pieces for the price sync worker:

- `PRICE_SYNC_KEY`

Optional runtime pieces for the price sync worker:

- `PRICES_API_URL`
  Defaults to `https://kidsledger.pages.dev/api/prices`
- `HOLIDAY_SCHEDULE_URL`
  Defaults to `https://www.twse.com.tw/holidaySchedule/holidaySchedule`
- `YAHOO_QUOTE_URL`
  Defaults to `https://query1.finance.yahoo.com/v7/finance/quote`

One-time deploy command:

```bash
npx wrangler deploy -c wrangler.price-sync.toml
```

Manual validation:

```bash
curl -H "x-price-sync-key: $PRICE_SYNC_KEY" \
  "https://kidsledger-price-sync.<your-subdomain>.workers.dev?dryRun=1&force=1"
```

- `dryRun=1` shows what would be updated without writing to D1
- `force=1` bypasses the normal weekday / market-hours / holiday guardrails

In-app manual trigger:

- the settings page button calls `POST /api/prices/sync`
- the Pages function then forwards the request to `PRICE_SYNC_TRIGGER_URL?force=1`
- `PRICE_SYNC_TRIGGER_URL` should be the deployed Worker URL, for example:
  `https://kidsledger-price-sync.<your-subdomain>.workers.dev`

This keeps `PRICE_SYNC_KEY` on the server side and lets the UI reuse the same worker sync flow.

### iPhone Shortcut Calendar Create

The repo also supports a shortcut-friendly event creation endpoint:

- `POST /api/calendar/shortcut-create`

Required runtime pieces:

- `CALENDAR_SHORTCUT_SECRET`

Expected request pattern:

- header: `x-calendar-shortcut-secret`
- JSON body:
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

Compatibility notes:

- `title` can also be sent as `事件標題 / 09:00-10:00`
- legacy nested shortcut payloads under `properties` are also accepted
- if `任務等級` includes `重要`, the API treats it as `autoRolloverEnabled=true`
- if a legacy shortcut only provides `執行日期` without a time, the event is created as an all-day event

The repo includes an experimental shortcut generator at:

- `scripts/generate_kidsledger_shortcut.py`

### GitHub Pages

This repo still contains a GitHub Pages workflow, but the active production setup is Cloudflare Pages.

If GitHub Actions is used for builds, provide:

- `VITE_GOOGLE_CLIENT_ID`
- `GEMINI_API_KEY` if AI advice remains enabled

## Data Model

Current D1 tables:

- `children`
- `transactions`
- `investments`
- `family_cash_records`
- `prices`
- `app_settings`
- `app_lock_passkeys`
- `app_lock_challenges`
- `calendar_connections`
- `calendar_members`
- `calendar_action_logs`
- `calendar_notification_jobs`

## Settings

Current settings stored in D1:

- `aiMentorEnabled`
- `aiApiLink`
- `idleLockMinutes`
- `telegramChatId`
- `telegramNotifyOnCreate`
- `telegramNotifyOnStart`
- `telegramBotTokenConfigured`
- `usdTwdReferenceRate`
- `usdTwdReferenceUpdatedAt`
- `usdTwdReferenceSource`

## Investment Notes

Current intended behavior for US stocks:

- trade price is stored in `USD`
- trade total is stored in trade currency
- `netAmountTwd` stores the TWD-side cost / proceeds used by summary cards
- realized and unrealized summary cards are shown in `TWD`
- original `USD` PnL is shown only as supporting text

FX behavior:

- each US trade stores its own `fxRateToTwd`
- the current USD/TWD reference rate is used only for valuation reference
- if the current reference rate is missing, the UI can fall back to the trade-side FX
- broker settlement accuracy still depends on manual correction by the user

Removed from user-facing settings:

- manual Google Client ID input
- Google Sheet ID / old cloud sync configuration

## Excel Export

The app can export a local `.xlsx` workbook containing:

- `Children`
- `Transactions`
- `Investments`
- `FamilyCash`
- `Prices`

This is now a backup/export feature, not the primary storage path.

## Phase 1 Verification Checklist

1. Open the app and sign in with an allowed Google account.
2. Confirm the app shows the lock screen before data is visible.
3. Enter a wrong password and confirm unlock is rejected.
4. Enter the correct `APP_LOCK_KEY` and confirm the ledger appears.
5. Change `閒置分鐘數` to `1`, save, and confirm idle re-lock works.
6. Edit a child name in settings and confirm it persists after refresh.

## Phase 2 Scaffolded Endpoints

Current scaffolded routes:

- `POST /api/app-lock/passkeys/register/options`
- `POST /api/app-lock/passkeys/register/verify`
- `POST /api/app-lock/passkeys/auth/options`
- `POST /api/app-lock/passkeys/auth/verify`
- `GET /api/app-lock/passkeys`

Current behavior:

- `options` endpoints generate and store D1 challenge records
- `register/verify` validates the registration challenge, origin, RP ID hash, and stores the credential public key
- `auth/verify` validates the assertion signature and counter, then issues a signed short-lived unlock token

This is deliberate to avoid shipping a fake security boundary.
