# WORKSTREAM.md — WS-1: Hosted Live-Data Layer

Branch: `ws/live-data`
Worktree: `../studio-worktrees/live-data`
Status: ready for implementation

---

## Objective

Replace the build-time `fs.readFileSync` read path in the Studio's lib files
with a runtime Upstash Redis read path. Make all six Studio pages dynamically
server-rendered on every request. Add authenticated ingestion API endpoints that
the local companion (WS-2) and Editorial Board inbox (WS-3) POST to. Provide a
sync-status endpoint for provenance display.

After WS-1 is deployed, vault updates arrive in the Studio without a git commit,
push, or Vercel redeployment.

---

## Shared contracts implemented

- `CLAUDE.md` — read before writing any code
- `docs/INGESTION_CONTRACT.md` — the exact payload schemas, authentication rules,
  stale-write policy, error format, and Redis key registry this workstream must
  implement faithfully

---

## Allowed files

This workstream may create or modify only:

```
lib/projection.ts
lib/workspace.ts
lib/editorial-board.ts
lib/today.ts
lib/iteration.ts
lib/redis.ts                         (new — Redis client singleton)
lib/data-result.ts                   (new — DataResult<T> type)
app/(studio)/today/page.tsx
app/(studio)/field/page.tsx
app/(studio)/formation/page.tsx
app/(studio)/iteration/page.tsx
app/(studio)/distribution/page.tsx
app/(studio)/memory/page.tsx
app/(studio)/layout.tsx
app/api/ingest/obsidian/route.ts     (new)
app/api/ingest/editorial-board/route.ts (new)
app/api/sync-status/route.ts         (new)
package.json                         (add @upstash/redis only)
next.config.ts                       (only if required for Redis; prefer not to touch)
```

---

## Forbidden files

Do not modify:
- `companion/` — owned by WS-2
- `integrations/` — read-only; do not modify
- `tools/` — read-only; do not modify
- `data/projections/obsidian.json` — fallback fixture; do not delete or auto-generate
- `data/projections/editorial-board.json` — fallback fixture; do not delete
- `data/studio/workspace.json` — fallback fixture; do not delete
- `CLAUDE.md`, `docs/INGESTION_CONTRACT.md` — owned by WS-0; read only
- Obsidian vault — never touched

---

## Implementation steps

### 1. Install dependency

```bash
npm install @upstash/redis
```

### 2. Create `lib/redis.ts`

A singleton Redis client using `Redis.fromEnv()`. Used by all lib read functions.
Do not instantiate Redis multiple times.

```typescript
import { Redis } from '@upstash/redis'
export const redis = Redis.fromEnv()
```

### 3. Create `lib/data-result.ts`

```typescript
export interface DataResult<T> {
  data: T
  source: 'live' | 'fallback' | 'default'
  lastSuccessfulSync: string | null
  stale: boolean
  error: string | null
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

export function isStale(lastSuccessfulSync: string | null): boolean {
  if (!lastSuccessfulSync) return true
  return Date.now() - new Date(lastSuccessfulSync).getTime() > STALE_THRESHOLD_MS
}
```

### 4. Update lib readers to async with KV-primary path

For each of `lib/projection.ts`, `lib/workspace.ts`, `lib/editorial-board.ts`:
- Make the internal load function `async`
- Try `redis.get(key)` first; on success, read `redis.get('{key}-meta')` for sync time
- On Redis error or empty result, fall back to `fs.readFileSync` (existing logic)
- Return a `DataResult<T>` instead of `T | null`
- The public function signatures become async:
  - `async function getProjection(): Promise<DataResult<Projection | null>>`
  - `async function getWorkspace(): Promise<DataResult<Workspace>>`
  - `async function getEditorialBoard(): Promise<DataResult<EditorialBoard | null>>`

### 5. Update `lib/today.ts` and `lib/iteration.ts`

- Make `getTodayBriefing()` and `getIterationView()` async (they call the lib readers)
- All internal logic is unchanged; only the call sites become awaited

### 6. Update page components

Add to each of the six Studio pages and the layout:

```typescript
export const dynamic = 'force-dynamic'
```

Make page functions `async`:

```typescript
export default async function TodayPage() {
  const briefing = await getTodayBriefing()
  // ...
}
```

Pass `briefing.source`, `briefing.lastSuccessfulSync`, and `briefing.stale` to
the `Provenance` component or a new sync-status display. The UI must not silently
present fallback data as live. See the live-versus-fallback read contract in
`docs/INGESTION_CONTRACT.md` §8.

### 7. Create ingestion endpoints

#### `app/api/ingest/obsidian/route.ts`

- Method: POST only; return 405 for others
- Content-Type check: reject non-`application/json` with 415 before reading body
- Size check: read `Content-Length` header; reject > 512KB with 413 before reading body
- Auth: extract `Authorization: Bearer <token>`; compare with `process.env.STUDIO_SYNC_SECRET`
  using `crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret))`; return 401 on failure
- If `STUDIO_SYNC_SECRET` is not set on server: return 500 immediately
- Parse body; validate envelope fields (see §1 of INGESTION_CONTRACT.md)
- Validate `data` against Obsidian projection schema (see §2a); reject unknown fields
- Run `validateProjection()` from `tools/validate-projection.mjs` if importable;
  otherwise apply the forbidden-key and path-leak checks inline
- Read `obsidian-projection-meta` from Redis; apply stale/duplicate checks (§6)
- On accept: backup to `obsidian-projection-prev`, write `obsidian-projection` and
  `obsidian-projection-meta` to Redis
- Return structured response per §9 of INGESTION_CONTRACT.md
- No secrets in logs; no secrets in error responses

#### `app/api/ingest/editorial-board/route.ts`

Same structure. Validates against Editorial Board schema (§2b). Writes to
`editorial-board` and `editorial-board-meta`.

#### `app/api/sync-status/route.ts`

- Method: GET only
- No authentication required
- Read `obsidian-projection-meta` and `editorial-board-meta` from Redis
- Return shape defined in §2e of INGESTION_CONTRACT.md
- Return 200 with empty/null values if keys don't exist yet

---

## Acceptance criteria

1. `npm run build` succeeds with zero type errors.
2. `npm run lint` passes.
3. In local dev (`npm run dev`): with `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` set and a live Upstash database:
   - POST a valid Obsidian projection payload to `/api/ingest/obsidian` with the
     correct auth header → 200, data appears in Redis
   - Visit `/today` → page shows `source: "live"` in provenance
   - POST the same payload again → 200 with `status: "idempotent"`
   - POST an older `projectedAt` → 409 with `error: "stale_payload"`
4. Without Redis env vars: pages render from fallback fixtures, provenance shows
   `source: "fallback"`.
5. Invalid auth → 401. Missing Content-Type → 415. Oversized body → 413.
6. Pages render correctly on mobile (phone browser).

---

## Security requirements

- Constant-time secret comparison only (`crypto.timingSafeEqual`)
- Secret absent on server → 500, not a silent bypass
- No secret values in any log statement
- No vault paths in any Redis value (validated by public-safety checker)
- Strict method + content-type + size checks before reading body
- Unknown fields in payload → 400, not silent ignore

---

## Test plan

1. Unit: validate the stale/duplicate write logic with mock Redis responses.
2. Integration: use a real Upstash free-tier database in a test environment.
3. Manual: end-to-end with WS-2 companion posting to local dev server.
4. Regression: existing Today and Iteration behavior unchanged when Redis is empty
   (fallback path must be identical to current behavior).

---

## Handoff requirements

Before marking WS-1 complete and requesting merge:
- All acceptance criteria pass
- No TypeScript errors (`npm run build`)
- No lint errors
- Both ingestion endpoints tested with valid and invalid payloads
- Fallback path verified (Redis absent or empty → fixture data, labeled correctly)
- Sync-status endpoint returns correct shape
- A brief summary of any deviations from the contract, with justification

---

## Known dependencies

- Requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in environment
  (injected by Vercel Marketplace integration — a manual step Pegah performs)
- Requires `STUDIO_SYNC_SECRET` in Vercel environment variables (Pegah generates
  and sets this once)
- WS-2 (companion) POST to these endpoints; the companion can be developed in
  parallel against this contract before WS-1 is deployed
- WS-3 (Editorial Board output) POSTs to `/api/ingest/editorial-board`; same
- WS-4 adds `/api/ingest/workspace-signals` and `/api/ingest/workspace-override`
  endpoints following the same pattern; those are not in WS-1 scope
- The `[STUDIO_URL]` placeholder in `CLAUDE.md` must be filled before testing
  WS-2 against the deployed WS-1 endpoint

---

## Coordinator Amendment — contract v1.1.0 (2026-07-12)

*Added under the documented coordinator exception (see CLAUDE.md ownership
table) after an independent audit and human-approved rulings. Where this
section conflicts with anything above, **this section and
`docs/INGESTION_CONTRACT.md` v1.1.0 govern.** Re-read the full contract before
replanning.*

1. **Atomic writes (§6).** Replace the read-check-backup-write sequence in the
   original steps with a single Redis `EVAL` (Lua) compare-and-set per
   ingestion write, operating on `{key}`, `{key}-meta`, `{key}-prev` in one
   atomic execution. No read-then-write in application code. On `idempotent`,
   the script refreshes only the server-owned `lastSuccessfulSync` heartbeat.
   Your implementation must satisfy the state machine locked by
   `tools/tests/contract-freshness.test.mjs`.
2. **Substantive hashing (§1b).** The server recomputes the payload hash from
   received `data` using `tools/canonical-hash.mjs` (import it; do not
   re-implement) — top-level `data.generatedAt` is excluded. Mismatch with the
   asserted `payloadHash` → 400 `invalid_schema`. Use the recomputed hash for
   comparison and storage.
3. **Timestamps (§1).** Validate the exact `Date.toISOString()` format
   (regex), convert to epoch ms, compare numerically.
4. **Auth (§3).** Length-safe constant-time comparison: validate header shape,
   handle unequal-length buffers without `timingSafeEqual` throwing, identical
   401 for every credential failure.
5. **Body size (§4).** Enforce actual received bytes (bounded read), not just
   the `Content-Length` header; reject malformed/negative declared lengths.
6. **Redis client.** Replace step 2's module-level `Redis.fromEnv()` with a
   lazy, guarded, server-only accessor. Missing/malformed Redis config is an
   explicit fallback condition — never a crashed import. Pages must render
   from fixtures with no Redis env vars.
7. **Snapshot rule (§8).** One `DataResult<T>` snapshot per data source per
   request; derive concepts/graph/details/emerging from that single snapshot
   with one metadata read. Audit every call site — module-scope reads (e.g. in
   the Memory page) move inside request-time functions.
8. **Workspace = Option A.** `lib/workspace.ts` keeps its fixture/default read
   path wrapped in `DataResult` (`source: "fallback" | "default"`). Do NOT
   read Workspace from Redis; the inferred/override merge is WS-4 scope.
9. **Editorial Board authority rule (§2b).** The ingestion endpoint rejects
   every non-empty `rulings` array **regardless of `updatedBy`** (400).
   `updatedBy` is provenance, never authorization. The Iteration UI must
   render live board content as advice only; rulings may render as human
   decisions only from the human-curated committed fixture.
10. **Sync-status (§2e).** GET-only, `force-dynamic`, `no-store`; Redis
    unreachable → 200 with `degraded: true` and null values (never 5xx, never
    internal detail); never-synced is distinguishable from status-unavailable.
11. **Schema version (§12).** Accept exactly `schemaVersion: 1`; reject all
    other values with 400.
12. **Shared infra is read-only for you:** `tools/canonical-hash.mjs`,
    `tools/vault-audit/_shared.mjs`, `integrations/` — import, never modify.

**Added verification gates (before WS-1 merge):** unit tests for strict
validation, auth edge cases (incl. unequal-length tokens), actual-byte size
enforcement, hash mismatch, idempotent/stale/duplicate outcomes; a concurrency
test demonstrating an older request cannot overwrite a newer one; fallback
rendering with Redis absent, visibly labeled; invalid/missing metadata never
appears fresh; no live-data route statically prerendered; both contract test
suites in `tools/tests/` pass.
