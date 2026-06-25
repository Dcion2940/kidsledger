# KidsLedger Repo Notes

This file defines the repo-local rules for KidsLedger.

## Purpose

- `README.md` is the project blueprint
- `docs/` is the engineering-source documentation layer
- Obsidian project management belongs in the user's Secondbrain vault, not inside this repo

Vault path:

- `/Users/milo/Library/CloudStorage/OneDrive-Personal/Secondbrain`
- project cockpit: `/Users/milo/Library/CloudStorage/OneDrive-Personal/Secondbrain/KidsLedger/專案工作流程.md`

## Repo Rules

- Keep architecture, workflow, checklist, and technical plan documents in `docs/`
- Do not recreate `知識庫/` or `Templates/` inside this repo unless the user explicitly asks
- If project management notes need updating, update the Secondbrain vault instead of adding repo-local Obsidian notes

## Writing Rules

- Do not store secrets, tokens, or passwords in notes
- Keep feature logic changes separate from documentation-structure changes when possible
- Prefer concise, durable summaries over verbose transcripts

## Safety

- Avoid destructive repo cleanup unless the user explicitly asks
- Do not overwrite existing vault notes without checking first

## Session Wrap-up

- Treat `收工` as both a product wrap-up and a git hygiene checkpoint
- Before ending a meaningful feature session, always check `git status`
- Do not leave deployed or user-validated changes uncommitted without explicitly recording that decision
- Prefer ending each completed feature or safe baseline with:
  - verification complete
  - deployment state confirmed
  - one intentional commit or an explicit note about why commit is deferred
- If the worktree is intentionally left dirty, summarize exactly what remains and why before ending the session
