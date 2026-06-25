---
title: KidsLedger Development Workflow
type: knowledge
date: 2026-05-12
updated: 2026-05-12
tags: [kidsledger, workflow, development]
status: active
---

# KidsLedger Development Workflow

This is the safe baseline workflow for future development.

## Local work

1. Put local frontend env values in `.env.local`
2. Start the app with `npm run dev`
3. Before shipping changes, run:
   - `npm run typecheck`
   - `npm run build`

Current scope:

- `npm run typecheck` validates the frontend app and shared browser-side code
- Cloudflare Functions and Workers should still be validated with targeted checks when those areas are changed

## Cloudflare app flow

### Pages app

- Frontend and Pages Functions deploy together from the repo root
- Standard build command: `npm run build`
- Standard deploy command: `npm run deploy:pages`

### Dedicated workers

Deploy workers independently when they change:

- `wrangler.rollover.toml`
- `wrangler.price-sync.toml`

## D1 migration flow

1. Add a new migration file with the next numeric prefix
2. Never edit an already-deployed migration in place
3. Apply migrations intentionally, one environment at a time

Note:

- There are legacy migrations in this repo with duplicate `0008` prefixes
- Treat those as historical artifacts
- Future migrations should continue from the latest applied sequence and avoid reusing numbers

## Editing rules

- Prefer adding new feature-specific code in `components/`, `functions/api/`, `workers/`, `services/`, or `utils/`
- Avoid growing `App.tsx` further unless the state truly belongs at the app shell level
- Reuse existing API boundaries rather than introducing direct client-side secrets

## Cleanup rules

- Do not mix unrelated projects into this repo
- `Sales_SOP_Assistants/` is intentionally treated as external noise and excluded from KidsLedger tooling
- If removal is desired later, do it as an isolated cleanup change
