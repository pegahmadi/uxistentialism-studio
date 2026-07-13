# WS-2 Approved Implementation Plan

Status: APPROVED for implementation (Pegah, 2026-07-12), in parallel with WS-1
against the FROZEN contract v1.1.1 and shared reference modules. Basis:
WORKSTREAM.md + its Coordinator Amendment + docs/INGESTION_CONTRACT.md v1.1.1.
Where they conflict, the contract governs. Committed under the documented
coordinator exception.

## Scope

Node daemon under `companion/` only: watches the vault read-only via the pure
`project()` import, validates, wraps in a companion-owned envelope, POSTs to
the ingestion API; watches `~/.studio-inbox/` for Editorial Board data-only
artifacts. Never writes the vault or `data/`; never modifies `integrations/`
or `tools/` (import only).

## Files (all under companion/)

`index.mjs` (entry: config+permission checks, ensure inbox dirs, startup
drain, watchers, reconcile timer, SIGUSR1/SIGTERM) · `config.mjs` (mode-600
enforcement — refuse to start otherwise; realpath-normalize all paths; secret
never serializable) · `status.mjs` (atomic temp+rename mode-600 writes; TWO
independent revision sequences; nextRevision/recordSuccess/
recordConflict(storedRevision)/recordError) · `projector.mjs` (~10-line
adapter over `project()`) · `validator.mjs` (obsidian: `validateProjection({
projection, vaultPath })` in-memory bridge — no temp files; editorial-board:
in-module §2b mirror) · `envelope.mjs` (envelope construction;
`substantiveHash` from `tools/canonical-hash.mjs`; exact toISOString
timestamps; JSON-safety guard before hashing) · `ingestor.mjs` (fetch POST,
Bearer auth, response classification, retry policy, secret never logged) ·
`sync-pipeline.mjs` · `vault-watcher.mjs` (chokidar, debounce, single-flight)
· `inbox-watcher.mjs` (startup drain + live watch) · `logger.mjs` (redacting)
· `package.json` (chokidar only) · `launch-agent.plist` (template only —
INSTALL IS MANUAL, WITHHELD) · `README.md`.

## Key implementation rules (v1.1.1)

1. **Pure projector**: `project({ vaultPath })` → `{ data, sourceUpdatedAt,
   missing }`; catches `VaultError` (incl. VAULT_EMPTY) → record error, never
   submit. Never write projection JSON. `sourceUpdatedAt` verbatim from the
   projector. `skipFolders` is additive.
2. **Envelope ownership (both endpoints)**: schemaVersion 1, source
   ("companion" | "editorial-board-inbox"), sourceUpdatedAt, projectedAt,
   revision from the endpoint's persisted sequence, payloadHash =
   `substantiveHash(data)`.
3. **Response semantics (§6)**: 200 accepted AND 200 idempotent = success
   (persist lastSuccess + revision sent). 409 stale_payload / duplicate =
   non-retryable: no lastSuccess, set lastConflict, recover
   `lastRevision = storedRevision` (next = storedRevision + 1, fresh
   projection). 4xx invalid_schema = contract drift: log, no retry, surface.
   5xx/network: 3 retries, 5s backoff, then stop until next trigger.
4. **Inbox artifact (§2b, ratified)**: exactly `{ "sourceUpdatedAt": "<exact
   toISOString>", "data": { …§2b… } }` — any other top-level key → rejected/;
   missing/malformed sourceUpdatedAt → rejected/ (never mtime substitution).
   Local §2b mirror rejects non-empty `rulings` AND `manuscript.status ===
   "complete"` (server enforces both too). Filename:
   `editorial-board-<ts>-<suffix>.json`; process order = parsed timestamp
   prefix asc, suffix tie-break, mtime fallback for nonconforming names.
5. **Startup drain**: enumerate existing files, oldest-first, serialized;
   size-stability wait before reading; one invalid file never blocks later
   valid ones; network failure leaves files for the next drain.
6. **Permissions**: config must be mode 600 (refuse otherwise; README installs
   with chmod 600); inbox + rejected/ created/verified mode 700; status writes
   atomic mode 600; logs never serialize config/headers/secret/paths (use the
   redacted messages from `tools/public-safety.mjs` where applicable).
7. **Path safety**: realpath-normalize the vault root; shared `walk()` already
   skips symlinks (coordinator-confirmed); allowlist remains the privacy
   boundary; no source path in any payload.
8. **No direct-POST fallback** for board sessions, ever.

## Verification gates (all must pass before handoff)

Unit: debounce/single-flight; revision persistence across restart (both
sequences independent); atomic status writes (failure between temp+rename
leaves prior state); envelope hash parity with `tools/canonical-hash.mjs`
(generatedAt-only change → same hash); §2b mirror rejects rulings/complete/
unknown-keys/missing-sourceUpdatedAt; drain ordering incl. tie-break and
nonconforming names; 409 recovery math. Integration (mock HTTP server
locally): success/401/409/5xx flows; secret absent from all logs. The three
shared `tools/tests/*.test.mjs` suites still pass. Lint clean.

## Environment constraints

No deployed WS-1 and no STUDIO_SYNC_SECRET yet — integration uses a local mock
HTTP server; end-to-end vs the real endpoint is deferred (WS-1 merges/deploys
first). LaunchAgent INSTALL and any `launchctl` execution are manual steps —
prepare the template + README only. npm installs must use a temp cache:
`npm install --cache /tmp/npm-cache-ws2` (user's ~/.npm has corrupted
entries). Never touch the real vault in tests — use synthetic temp vaults
(see tools/tests/projector.test.mjs for the pattern).

## Coordinator rulings on this workstream's questions

In-memory `validateProjection({ projection })` bridge exists (no temp files).
Inbox wire format + filename ratified as above. WS-2 owns the local §2b
mirror. Missing sourceUpdatedAt → rejected/. Symlink duty = realpath the root
only. Drain order = filename timestamp primary, mtime fallback.

## Process

Commit incrementally to ws/companion only. Never commit to main, never push,
never merge, never run launchctl. Cross-workstream needs → Coordinator.
Report handoff with verification results and any contract ambiguity.
