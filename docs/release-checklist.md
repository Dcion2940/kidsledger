---
title: KidsLedger Release Checklist
type: knowledge
date: 2026-05-12
updated: 2026-06-25
tags: [kidsledger, release, checklist]
status: active
---

# KidsLedger Release Checklist

Use this checklist before shipping app changes.

## Session close-out hygiene

Use this section whenever we `收工`, even if the session does not end with a production deploy.

1. Run the needed verification for the feature that changed
2. Check `git status`
3. Remove or ignore obvious temp files before ending the session
4. Confirm whether the current worktree represents:
   - a finished feature ready to commit
   - a safe baseline that has already been validated or deployed
   - an intentionally incomplete checkpoint that must be called out clearly
5. If the current state is already validated, do not leave it only as dirty working tree changes:
   - create one intentional commit
   - or explicitly record why commit is being deferred
6. If a deploy happened, record which commit corresponds to that deploy before ending the session
7. Re-check `git status` and aim to end with a clean worktree
8. If the worktree must stay dirty, leave a concise summary of:
   - what is still uncommitted
   - whether it is deployed or not
   - what the next session should do first

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
4. Record the deployed commit SHA before ending the session
5. If the release touches investments:
   - add one TW trade
   - add one US trade
   - verify USD/TWD reference rate appears in settings
   - verify US trade FX auto-fill can still be manually overridden
