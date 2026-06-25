---
title: D1 Migration Notes
type: knowledge
date: 2026-05-12
updated: 2026-05-12
tags: [kidsledger, database, migrations]
status: active
---

# D1 Migration Notes

These migrations are append-only history for KidsLedger.

## Rules

- Never rewrite or rename a migration that has already been applied remotely
- Add new schema work as a new file with the next available numeric prefix
- Keep each migration narrowly scoped to one schema change

## Historical note

This repo already contains two legacy files using the `0008` prefix:

- `0008_add_actor_to_family_cash_records.sql`
- `0008_create_calendar_connections.sql`

Treat this as historical baggage, not a pattern to repeat.

For future migrations, continue from the latest known sequence and do not reuse an existing prefix.
