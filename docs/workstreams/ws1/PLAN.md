# WS-1 Approved Implementation Plan

Status: APPROVED for implementation (Pegah, 2026-07-12) against contract
v1.1.1 (frozen). Basis: WORKSTREAM.md + its Coordinator Amendment +
docs/INGESTION_CONTRACT.md v1.1.1. Where they conflict, the contract governs.
Committed under the documented coordinator exception.

## Scope

Replace the build-time fs read path in `lib/*` with a request-time Upstash
Redis read path wrapped in `DataResult<T>`; make all six routes dynamic; add
two authenticated ingestion endpoints + public sync-status. Dropped from the
original brief: Redis-backed Workspace (Option A), read-then-write sequences,
module-level `Redis.fromEnv()`.

## Files

Create: `lib/redis.ts` (lazy guarded accessor + Lua CAS script + `evalIngest()`),
`lib/data-result.ts`, `app/api/ingest/obsidian/route.ts`,
`app/api/ingest/editorial-board/route.ts`, `app/api/sync-status/route.ts`,
`tests/ws1/*.test.mjs` (zero-dependency node tests — WS-1-owned path).
Modify: `lib/projection.ts`, `lib/editorial-board.ts`, `lib/workspace.ts`
(Option A wrap only), `lib/today.ts`, `lib/iteration.ts`, the six
`app/(studio)/*/page.tsx`, `app/(studio)/layout.tsx`, `package.json`
(add `@upstash/redis` ONLY). `next.config.ts` only if unavoidable.

## Key implementation rules (v1.1.1)

1. **Atomic Lua CAS** on `{key}`/`{key}-meta`/`{key}-prev`; idempotent branch
   refreshes ONLY `lastSuccessfulSync`; must satisfy the state machine in
   `tools/tests/contract-freshness.test.mjs`. Timestamps: validate exact
   `Date.toISOString()` regex → epoch ms → numeric comparison only.
2. **Substantive hash**: import `substantiveHash` from
   `tools/canonical-hash.mjs` (never re-implement); recompute server-side;
   mismatch → 400; use recomputed hash for comparison + storage.
3. **Route order**: 405 method → 415 content-type → 413 declared length →
   auth (500 if secret unset; length-safe timingSafeEqual; identical 401s) →
   bounded actual-byte read (413 over 512KB) → envelope validation (exact
   key set; `schemaVersion === 1` exactly; source enum; revision ≥ 1) →
   data schema (§2a/§2b strict, unknown fields 400) → public-safety scan via
   `tools/public-safety.mjs` (violations already redacted) → hash recompute →
   atomic EVAL → §9 responses (409s carry storedRevision/storedProjectedAt).
4. **§2b authority rules (server-enforced)**: reject non-empty `rulings`
   regardless of `updatedBy`; reject `manuscript.status: "complete"` on every
   live submission. Iteration UI renders live board content as advice; rulings
   as human decisions only from the committed fixture.
5. **Snapshot rule**: one `DataResult` per source per request;
   `getGraph`/`getConcepts`/`getGraphDetails`/`getEmerging`/`getConcept`
   become pure derivations over the snapshot; move `memory/page.tsx`
   module-scope reads inside the async page; audit every call site.
6. **Workspace Option A**: fixture/default only, wrapped in `DataResult`
   (`source: "fallback" | "default"`); no Redis workspace keys.
7. **sync-status (§2e)**: GET-only, force-dynamic, no-store; Redis unreachable
   → 200 `{degraded: true}` + nulls; key-absent ≠ unreachable;
   **`lastAttempt` is always null in v1** — never fabricated.
8. Shared infra read-only: `tools/`, `integrations/` — import, never modify.

## Verification gates (all must pass before handoff)

Unit tests (tests/ws1/): strict validation matrix; auth edge cases incl.
unequal-length tokens; actual-byte 413 with lying Content-Length; hash
mismatch; generatedAt-only change hashes identical; idempotent/stale/duplicate
outcomes; **concurrency test** (older request racing newer → newer survives,
older 409s, repeated interleavings). Fallback render with no Redis env,
visibly labeled; stale/missing metadata never appears fresh; `npm run build`
shows all six routes dynamic (ƒ); `npm run lint` clean; all three
`tools/tests/*.test.mjs` suites still pass.

## Environment constraints

No Upstash credentials exist yet (manual step withheld) — unit tests use a
mock/fake Redis; live integration tests are deferred to deployment
authorization. Never attempt external network calls. npm installs must use a
temp cache: `npm install --cache /tmp/npm-cache-ws1` (user's ~/.npm has
corrupted entries).

## Coordinator rulings on this workstream's questions

Tests → `tests/ws1/` (granted in CLAUDE.md). Endpoint validator = inline
schema + shared `tools/public-safety.mjs` (NOT `validateProjection`, which is
fixture/allowlist-coupled). `lastAttempt` → null in v1. `deferredThreads` →
rejected in submitted data; fixture reader keeps tolerating it.

## Process

Commit incrementally to ws/live-data only. Never commit to main, never push,
never merge. Cross-workstream needs → Coordinator. Report handoff with
verification results and any contract ambiguity encountered.
