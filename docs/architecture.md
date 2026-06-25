---
title: KidsLedger Architecture
type: knowledge
date: 2026-05-12
updated: 2026-06-20
tags: [kidsledger, architecture]
status: active
---

# KidsLedger Architecture

This document describes the intended project shape for KidsLedger without rewriting the current app structure.

## Runtime Layers

### Frontend app

- Entry: `index.tsx`
- Main shell: `App.tsx`
- Reusable UI: `components/`
- Local client helpers: `services/`, `utils/`

### Pages Functions

- API routes live under `functions/api/`
- These routes are the server boundary for:
  - D1 reads and writes
  - app lock verification
  - calendar integration
  - Telegram jobs
  - AI-backed server features
  - stock price sync proxying
  - FX reference rate fetching and caching

### Workers

- Dedicated cron and utility workers live under `workers/`
- Current workers:
  - `workers/calendar-rollover-cron.ts`
  - `workers/price-sync-cron.ts`

Important note:

- `workers/price-sync-cron.ts` is currently optimized for TW stocks
- US stock price timing should not be treated as equivalent to Taiwan market timing
- FX reference updates also have a different cadence from stock quotes
- long-term, think in three update lanes:
  - TW stock prices
  - US stock prices
  - USD/TWD reference rate

### Database

- D1 schema changes are tracked in `migrations/`
- Migrations are append-only and should not be rewritten after deploy

## Directory Responsibilities

- `App.tsx`: top-level app state and cross-feature orchestration
- `components/`: feature UI components
- `services/`: browser-side integration helpers
- `utils/`: local pure utilities and storage helpers
- `functions/api/`: Cloudflare Pages Functions routes
- `workers/`: dedicated Workers that should stay decoupled from Pages request flow
- `docs/`: architecture, workflow, and feature plans
- `migrations/`: D1 schema evolution only

Notable investment-related files:

- `components/InvestmentRecord.tsx`
  - investment UI for TW + US stock flows
- `utils/investments.ts`
  - investment normalization and fee / FX / TWD valuation helpers
- `functions/api/fx/usd-twd.ts`
  - cached USD/TWD reference rate endpoint backed by Frankfurter

## Project Boundaries

The `Sales_SOP_Assistants/` directory is not part of KidsLedger.

- It is a separate nested project with its own `.git`
- It should not participate in KidsLedger build, typecheck, deploy, or documentation flows
- KidsLedger tooling now excludes it on purpose to reduce accidental coupling

If it is no longer needed on disk, remove it as a separate cleanup step after confirming nothing external still depends on it.
