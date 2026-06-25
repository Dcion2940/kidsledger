---
title: KidsLedger App Lock Phase 2 Plan
type: knowledge
date: 2026-05-12
updated: 2026-05-12
tags: [kidsledger, app-lock, passkey, roadmap]
status: in-progress
---

# KidsLedger App Lock Phase 2 Plan

This document describes the next phase for replacing or supplementing the password-based unlock flow with WebAuthn / Passkey so iPhone users can unlock with Face ID or Touch ID.

## Goal

- Keep the existing site-wide idle lock behavior.
- Add Passkey as a stronger unlock method.
- Support iPhone Safari with Face ID / Touch ID via platform authenticators.
- Keep password unlock as an optional fallback.

## Recommended architecture

### 1. Credential storage in D1

Create a table for registered passkeys:

- `id`
- `account_scope`
- `credential_id`
- `public_key`
- `counter`
- `device_name`
- `transports`
- `rp_id`
- `created_at`
- `updated_at`
- `last_used_at`
- `revoked_at`

`account_scope` can initially be a global value such as `family-default` if KidsLedger still uses one shared unlock identity for the entire site.

### 2. Challenge storage in D1

Create a short-lived challenge table:

- `id`
- `flow_type` (`register` or `authenticate`)
- `account_scope`
- `challenge`
- `user_handle`
- `expires_at`
- `used_at`
- `created_at`

Rules:

- challenge lifetime: 3 to 5 minutes
- each challenge can be used only once
- successful verification must immediately mark `used_at`

## Registration flow

### API: `POST /api/app-lock/passkeys/register/options`

Backend responsibilities:

- generate a random challenge
- store the challenge in D1
- return WebAuthn `PublicKeyCredentialCreationOptions`

Suggested response fields:

- `challenge`
- `rp.name`
- `rp.id`
- `user.id`
- `user.name`
- `user.displayName`
- `pubKeyCredParams`
- `authenticatorSelection`
- `timeout`
- `attestation`

Frontend responsibilities:

- call `navigator.credentials.create()`
- prefer platform authenticators when possible
- send the attestation result back to the server

### API: `POST /api/app-lock/passkeys/register/verify`

Backend must verify:

- challenge matches stored record
- challenge not expired
- challenge not already used
- `origin` matches the production site
- `rpIdHash` matches the expected RP ID
- attestation / credential public key parsing succeeds

On success:

- save `credential_id`
- save `public_key`
- save `counter`
- save `transports`
- save metadata such as `device_name`

## Authentication flow

### API: `POST /api/app-lock/passkeys/auth/options`

Backend responsibilities:

- generate a new random challenge
- store it in D1
- return `PublicKeyCredentialRequestOptions`

Suggested response fields:

- `challenge`
- `rpId`
- `allowCredentials`
- `userVerification`
- `timeout`

Frontend responsibilities:

- call `navigator.credentials.get()`
- let Safari trigger Face ID / Touch ID / device passkey UX
- send the assertion result back to the server

### API: `POST /api/app-lock/passkeys/auth/verify`

Backend must verify:

- challenge matches stored record
- challenge not expired
- challenge not already used
- `origin` is allowed
- `rpIdHash` matches expected RP ID
- signature is valid against stored public key
- authenticator counter is greater than the stored counter

On success:

- update credential counter
- update `last_used_at`
- issue a short-lived unlock session token

## Unlock session recommendation

Phase 1 uses client-side session state because the goal is privacy against casual access.

For Phase 2, move to a short-lived server-issued unlock token:

- signed token or opaque session id
- lifetime: 5 to 15 minutes
- stored in memory or `sessionStorage`
- token should be cleared when the app locks again

This improves integrity over a plain client-side boolean.

## iPhone / Face ID compatibility notes

- Use HTTPS only
- Prefer a custom production domain for stable `rp.id`
- Ensure the RP ID matches the final site domain exactly
- Set `userVerification: "required"` for stronger biometric confirmation
- Use platform authenticators first for the smoothest Face ID flow

## Suggested rollout order

1. Add D1 tables for passkeys and challenges.
2. Add registration endpoints.
3. Add authentication endpoints.
4. Add settings UI for "新增 Passkey".
5. Keep password unlock as fallback during rollout.
6. After validation, allow admins to require Passkey for unlock.

## Open product decisions

- Is unlock identity shared by the whole family site or per adult manager?
- Should multiple passkeys be allowed per shared ledger?
- Should password remain enabled permanently as fallback?
- Do we want passkey management behind the existing hidden admin flow?
