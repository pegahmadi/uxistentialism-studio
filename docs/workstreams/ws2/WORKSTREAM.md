# WORKSTREAM.md — WS-2: Local Studio Sync Companion

Branch: `ws/companion`
Worktree: `../studio-worktrees/companion`
Status: ready for implementation

---

## Objective

Build a Node.js daemon that runs on Pegah's Mac, watches the Obsidian vault for
file changes, generates and validates a sanitized projection, and POSTs it
authenticated to the hosted Studio's ingestion endpoint. Also watches a private
inbox folder for Editorial Board output files and submits them. Runs continuously
in the background, launches on login, and never requires a manual command for
routine vault updates.

---

## Shared contracts implemented

- `CLAUDE.md` — read before writing any code
- `docs/INGESTION_CONTRACT.md` — the companion is the primary payload producer;
  every payload it sends must conform exactly to the envelope and data schemas
  defined in §1–2, the authentication contract in §3, size limits in §4, and
  provenance timestamps in §10

---

## Allowed files

This workstream creates only:

```
companion/
  index.mjs             main entry point; starts watchers; handles signals
  watcher.mjs           chokidar vault watcher with debounce
  inbox-watcher.mjs     inbox folder watcher for Editorial Board drops
  projector.mjs         calls integrations/obsidian/project.mjs as a library
  validator.mjs         calls tools/validate-projection.mjs validateProjection()
  ingestor.mjs          authenticated HTTP POST to ingestion endpoints
  config.mjs            reads ~/.config/uxistentialism-studio/config.json
  status.mjs            reads/writes ~/.config/uxistentialism-studio/status.json
  package.json          companion-specific; separate from the Studio's package.json
  launch-agent.plist    macOS LaunchAgent template
  README.md             installation and usage instructions
```

Do not create files outside `companion/`. The install step places the LaunchAgent
plist on the user's Mac, but the template lives here.

---

## Forbidden files

Do not modify:
- `lib/`, `app/`, `next.config.ts`, `package.json` (root) — owned by WS-1
- `integrations/obsidian/project.mjs` — import and call it; do not modify it
- `tools/validate-projection.mjs` — import and call it; do not modify it
- `integrations/obsidian/allowlist.json` — read-only
- `data/` — do not write projection files; the companion submits to the API
- `CLAUDE.md`, `docs/INGESTION_CONTRACT.md` — read only
- Obsidian vault — never touched; strictly read-only

---

## Implementation

### Config schema (`~/.config/uxistentialism-studio/config.json`)

```json
{
  "vaultPath": "/Users/you/Desktop/Obsidian-UXistentialism",
  "studioUrl": "https://[STUDIO_URL]",
  "syncSecret": "<STUDIO_SYNC_SECRET value>",
  "watchGlob": "UXistentialism/**/*.md",
  "debounceMs": 3000,
  "reconcileIntervalMs": 21600000,
  "inboxPath": "/Users/you/.studio-inbox",
  "logPath": "/Users/you/Library/Logs/studio-companion.log"
}
```

Config is read on startup and cached. Malformed or missing config causes the
companion to exit with a clear error (not a silent no-op).

### Status schema (`~/.config/uxistentialism-studio/status.json`)

```json
{
  "obsidianProjection": {
    "lastAttempt": "2026-07-11T10:30:05.123Z",
    "lastSuccess": "2026-07-11T10:30:05.456Z",
    "lastRevision": 42,
    "lastPayloadHash": "sha256-abc123...",
    "lastError": null
  },
  "editorialBoard": {
    "lastAttempt": null,
    "lastSuccess": null,
    "lastRevision": 0,
    "lastPayloadHash": null,
    "lastError": null
  }
}
```

### Vault watcher behavior (`watcher.mjs`)

- Watch `{vaultPath}/{watchGlob}` with `chokidar` using `{ persistent: true, ignoreInitial: true }`
- On `add` or `change` event: start or reset the debounce timer (`debounceMs`, default 3000ms)
- On debounce fire: call the full sync pipeline (project → validate → ingest)
- Queue only one pending sync at a time. If a sync is in progress when the debounce
  fires, queue one more to run after the current one finishes. Discard intermediate
  events; only the latest state matters.
- Periodic reconciliation: run a full sync every `reconcileIntervalMs` (default 6h)
  regardless of file events, as a safety net against missed events.
- On SIGUSR1 signal: trigger an immediate sync bypassing the debounce and queue.

### Sync pipeline (called by watcher and reconciliation)

```
project()     → calls integrations/obsidian/project.mjs logic
              → returns { concepts, connections, emerging, generatedAt }

validate()    → calls tools/validate-projection.mjs validateProjection()
              → if invalid: log error, do NOT retry, do NOT submit
              → if valid: continue

ingest()      → construct full envelope (schemaVersion, source, timestamps,
                revision, payloadHash, data)
              → POST to {studioUrl}/api/ingest/obsidian
              → on 200: update status.json with success
              → on 409 (stale/idempotent): log info, update status
              → on 4xx (schema error): log error, do NOT retry
              → on 5xx or network error: retry up to 3 times with 5s backoff;
                after 3 failures, log error and stop until next trigger
```

Revision tracking: read `status.obsidianProjection.lastRevision` from status.json,
increment by 1, include in payload. Initialize to 1 if null.

PayloadHash: SHA-256 of `JSON.stringify(data)` with `sha256-` prefix.

### Inbox watcher (`inbox-watcher.mjs`)

- Watch `{inboxPath}/*.json`
- On new file: read it, validate against Editorial Board schema (§2b of contract),
  POST to `/api/ingest/editorial-board`
- On success: delete the file from inbox
- On validation failure: move to `{inboxPath}/rejected/[timestamp]-[filename]`,
  log the validation errors
- On network failure: retry up to 3 times; on final failure, leave the file in
  inbox (it will be retried on next startup)
- Create `inboxPath` directory if absent (do not fail if it doesn't exist yet)

### LaunchAgent (`launch-agent.plist`)

Provide a template the user copies to `~/Library/LaunchAgents/com.uxistentialism.studio-companion.plist`.
Key fields:
- `Label`: `com.uxistentialism.studio-companion`
- `ProgramArguments`: `["node", "/path/to/companion/index.mjs"]`
- `RunAtLoad`: true
- `KeepAlive`: true
- `StandardOutPath`: value of `logPath` from config
- `StandardErrorPath`: value of `logPath` from config
- `EnvironmentVariables`: empty (credentials come from config file, not env)

Provide a one-line install command in README.md:
```bash
launchctl load ~/Library/LaunchAgents/com.uxistentialism.studio-companion.plist
```

---

## Acceptance criteria

1. `node companion/index.mjs` starts without error when config.json is present.
2. Modifying an allowlisted vault note triggers a sync within `debounceMs + ~2s`
   (projection + validation + network).
3. The POST reaches `/api/ingest/obsidian` and returns 200.
4. `status.json` is updated with `lastSuccess` and `lastRevision`.
5. A second modification within `debounceMs` does not trigger two syncs — only one.
6. A payload with a stale `projectedAt` returns 409 and is not retried.
7. An invalid vault note (triggering public-safety validation failure) does not
   submit a payload and logs the error clearly.
8. The periodic reconciliation runs on the configured interval.
9. SIGUSR1 triggers an immediate sync.
10. LaunchAgent template loads with `launchctl load` without error.

**Full acceptance test (end-to-end with WS-1 deployed):**
Edit an allowlisted Obsidian note. Without running any command, editing JSON,
committing, pushing, or redeploying: navigate to the Studio on a phone browser
and see the change reflected. Provenance shows `source: "live"`.

---

## Security requirements

- `syncSecret` lives in `~/.config/uxistentialism-studio/config.json` only.
  This file must be mode 600. The companion should warn if it is world-readable.
- The secret must never appear in log output.
- The companion must never write anything to the Obsidian vault.
- The companion must never read files outside the configured `vaultPath`.
- The companion must never store vault file paths in the submitted payload.
  The existing `validate-projection.mjs` enforces this; the companion must call it.

---

## Test plan

1. Unit: debounce logic (multiple rapid events → single sync).
2. Unit: revision incrementing (reads from status.json, increments, stores back).
3. Unit: payloadHash computation matches server's expected format.
4. Integration: POST to a running local WS-1 dev server (`npm run dev` in the
   Studio repo) and verify 200 response and Redis write.
5. Integration: inbox watcher drops a valid Editorial Board JSON file → companion
   submits it → file is deleted.
6. Manual: LaunchAgent install and verify it runs on login.

---

## Handoff requirements

Before marking WS-2 complete:
- All acceptance criteria pass including the end-to-end test
- README.md documents installation, config schema, and troubleshooting
- `launchctl list | grep uxistentialism` shows the agent running
- No secrets appear in `~/Library/Logs/studio-companion.log`
- Companion handles network-unavailable gracefully (retries, then stops)

---

## Known dependencies

- **WS-1 must be deployed** before the end-to-end acceptance test can pass.
  The companion can be fully implemented and unit/integration tested against a
  local dev server before WS-1 is deployed.
- The companion imports from `integrations/obsidian/project.mjs` and
  `tools/validate-projection.mjs` using relative paths. Do not move those files.
- Config must contain the correct `[STUDIO_URL]` (replace the placeholder in
  `CLAUDE.md` once the production URL is confirmed).
- `STUDIO_SYNC_SECRET` must match between `~/.config/uxistentialism-studio/config.json`
  and the Vercel `STUDIO_SYNC_SECRET` environment variable.

---

## Coordinator Amendment — contract v1.1.0 (2026-07-12)

*Added under the documented coordinator exception (see CLAUDE.md ownership
table) after an independent audit and human-approved rulings. Where this
section conflicts with anything above, **this section and
`docs/INGESTION_CONTRACT.md` v1.1.0 govern.** Re-read the full contract before
replanning.*

1. **Use the pure projector.** `integrations/obsidian/project.mjs` now exports
   `project({ vaultPath, allowlistPath?, skipFolders? })` returning
   `{ data: { generatedAt, concepts, connections, emerging }, sourceUpdatedAt,
   missing }`. It throws (`VaultError`) instead of exiting and **writes
   nothing** — the original `projector.mjs` plan ("calls project.mjs as a
   library") is now literally possible. Never write `data/projections/*.json`.
   `sourceUpdatedAt` comes from the projector (newest mtime among all scanned
   notes); do not compute it yourself. `skipFolders` is additive — safety
   defaults are always preserved.
2. **You own the complete transport envelope for BOTH endpoints** —
   `schemaVersion`, `source`, `sourceUpdatedAt`, `projectedAt`, `revision`,
   `payloadHash` — including inbox submissions. Inbox artifacts arrive as
   **data-only** (plus a source-event timestamp); validate the data, then
   construct the canonical envelope yourself. Maintain **separate persisted
   revision sequences** for `obsidian-projection` and `editorial-board` in
   status.json, written **atomically** (temp file + rename, restrictive mode)
   so a crash cannot corrupt or roll back revision state.
3. **Hashing (§1b).** Compute `payloadHash` with `tools/canonical-hash.mjs`
   (`substantiveHash`) — import it; do not re-implement. Top-level
   `data.generatedAt` is excluded, so reprojections of an unchanged vault are
   idempotent by design.
4. **Timestamps (§1).** Exact `Date.toISOString()` format everywhere.
5. **Response semantics (§6).** 200 `idempotent` is SUCCESS — update
   `lastSuccess` normally (the server refreshed its heartbeat). 409
   `stale_payload` / 409 `duplicate` are NON-retryable conflicts: do not
   retry the same payload, do not record `lastSuccess`, surface visibly in
   status, and recover the sequence from the response's `storedRevision`
   (next submission uses `storedRevision + 1` with a fresh projection).
   Replace the original brief's "409 (stale/idempotent)" wording with these
   semantics.
6. **Startup inbox drain.** On startup, enumerate existing inbox files and
   process them deterministically oldest-first, serialized (preserves
   monotonic revisions). One invalid file must not block later valid files.
   Handle duplicate and partially-written files; wait for file-size stability
   before reading a newly created file.
7. **Permissions.** Refuse to start if the secret-bearing config is not mode
   600 (or explicitly repair permissions during install — pick one and
   document it). Create and verify `~/.studio-inbox/` and its `rejected/`
   subdirectory with mode 700. Logs must never serialize config, headers,
   secrets, or private paths.
8. **Path safety.** Resolve and normalize all configured paths; ensure every
   scanned file stays inside the configured vault root (defend against
   symlink escapes); the allowlist remains the projection privacy boundary;
   no source path ever appears in a payload.
9. **No direct-POST fallback exists for board sessions** (CLAUDE.md): if you
   are offline, inbox artifacts wait and are drained on restart.
10. **Shared infra is read-only for you:** `integrations/obsidian/project.mjs`,
    `tools/canonical-hash.mjs`, `tools/vault-audit/_shared.mjs`,
    `tools/validate-projection.mjs` — import, never modify.

**Added verification gates (before WS-2 merge):** projector runs without
writing committed JSON; debounce/single-flight tested; revision persistence
survives restart; status writes atomic; startup drain works (incl. partial and
invalid files → rejected/); secrets never in logs; config/inbox permissions
verified; network failure leaves recoverable work.
