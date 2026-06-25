---
title: KidsLedger Release Checklist
type: knowledge
date: 2026-05-12
updated: 2026-06-20
tags: [kidsledger, release, checklist]
status: active
---

# KidsLedger Release Checklist

Use this checklist before shipping app changes.

## App changes

1. Run `npm run typecheck`
2. Run `npm run build`
3. Verify the affected UI flow locally
4. If `App.tsx` changed, sanity-check the main tabs:
   - dashboard
   - investments
   - settings
   - calendar

## API or D1 changes

1. Confirm the affected Pages Functions route still returns expected shapes
2. If schema changed, add a new migration file instead of editing an old one
3. Apply migrations intentionally per environment
4. If investment or settings schema changed, verify old localStorage data still normalizes safely

## Worker changes

1. Build and inspect the related worker file
2. Re-deploy the dedicated worker separately if needed:
   - `wrangler.rollover.toml`
   - `wrangler.price-sync.toml`
3. If the worker calls back into Pages, verify the target URL and secret names still match
4. For investment data changes, sanity-check whether the TW price worker assumptions still hold for any US symbols now stored in `prices`

## Deploy

1. Deploy Pages with `npm run deploy:pages` or the equivalent Wrangler command
2. Open the deployment URL
3. Smoke-test the changed user flow in production
4. If the release touches investments:
   - add one TW trade
   - add one US trade
   - verify USD/TWD reference rate appears in settings
   - verify US trade FX auto-fill can still be manually overridden
