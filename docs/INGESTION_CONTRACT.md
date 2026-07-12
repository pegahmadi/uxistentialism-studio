# UXistentialism Studio — Ingestion Contract

Version: 1.1.0 · 2026-07-12

This document is the authoritative specification for every payload the local
Studio Sync companion sends to the hosted Studio, and for every payload the
hosted Studio stores in Upstash Redis. Both the companion and the server must
implement this contract identically.

Any change to schemas, key names, authentication rules, or versioning policy
requires a new contract version and coordinated updates to the companion and
the server before deployment.

**v1.1.0 changes (coordinator ruling after independent audit):** companion-owned
transport envelope; canonical serialization + server-side hash recomputation
(§1b); strict timestamp format; Editorial Board `rulings` must be empty on the
v1 ingestion endpoint (§2b); atomic compare-and-set writes (§6); actual-byte
size enforcement (§4); length-safe authentication (§3); sync-status degraded
behavior (§2e); single-snapshot read rule and lazy Redis client (§8);
`sourceUpdatedAt` semantics (§10); exact-version validation (§12).

---

## 1. Payload envelope

Every payload sent to any ingestion endpoint uses this top-level structure.

```json
{
  "schemaVersion": 1,
  "source": "companion",
  "sourceUpdatedAt": "2026-07-11T10:30:00.000Z",
  "projectedAt":    "2026-07-11T10:30:05.123Z",
  "revision":        42,
  "payloadHash":    "sha256-abc123def456...",
  "data":           { }
}
```

### Envelope ownership

**The companion is the sole author of the transport envelope** for every
submission — vault projections and inbox artifacts alike. Upstream producers
(e.g. the Editorial Board skill) emit **data only**, plus any source-event
timestamp the companion needs to derive `sourceUpdatedAt`. The companion
validates the data, assigns the next per-endpoint `revision` from its persistent
status file, computes `payloadHash` (§1b), and constructs the envelope. No board
session or other upstream producer ever chooses a transport revision or hash.

### Envelope field definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | integer | yes | Contract version. Currently `1`. |
| `source` | string | yes | Who sent this payload. See allowed values below. |
| `sourceUpdatedAt` | ISO 8601 UTC | yes | Newest mtime among source files that can affect this payload (see §10). Not when the companion ran. |
| `projectedAt` | ISO 8601 UTC | yes | When the companion generated and validated this payload. |
| `revision` | integer ≥ 1 | yes | Monotonically increasing per endpoint, tracked in companion status file. |
| `payloadHash` | string | yes | `sha256-` prefix followed by hex SHA-256 of the canonical serialization of `data` (§1b). |
| `data` | object | yes | Payload body. Schema varies by endpoint. |

### Timestamp format

`sourceUpdatedAt`, `projectedAt`, and every ISO timestamp inside `data` MUST use
the exact `Date.toISOString()` format — `YYYY-MM-DDTHH:mm:ss.sssZ`, validated by
`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`. Any other ISO 8601 variant is
rejected with 400 `invalid_schema`. Before any ordering comparison (§6), the
server converts timestamps to epoch milliseconds and compares numerically —
never by string comparison.

### Allowed `source` values

| Value | Meaning |
|---|---|
| `"companion"` | Local Studio Sync companion (Obsidian or workspace signals) |
| `"editorial-board-inbox"` | Editorial Board output dropped into the watched inbox |
| `"studio-ui"` | Workspace override submitted from within the Studio (WS-4) |

Unknown top-level fields are rejected with 400.

---

## 1b. Canonical serialization and hashing

`payloadHash` is computed over the **canonical serialization** of the `data`
object:

1. Objects: keys sorted lexicographically by Unicode code point, recursively.
2. **Arrays retain their order** (order is semantically meaningful).
3. No insignificant whitespace.
4. Strings, numbers, booleans, and `null` serialize per `JSON.stringify`
   semantics (shortest round-trip numbers, standard string escaping).
5. The canonical string is UTF-8 encoded before hashing.
6. `payloadHash = "sha256-" + hex(SHA-256(bytes))`.

**Substantive-hash exception.** The **top-level `data.generatedAt` field is
excluded from the hash input** by both the companion and the server (the field
itself remains required in the Obsidian payload). `generatedAt` is temporal
metadata of a projection *run*; `payloadHash` means *identity of the
substantive projection*. Without this exception every reprojection of an
unchanged vault would produce a new hash and the idempotent path (§6) could
never trigger for reconciliations. Only the top-level key is excluded — any
nested field of the same name is hashed normally. (A future schema version may
remove `generatedAt` from `data` entirely, since `projectedAt` already records
projection time; it is retained in v1 for backward compatibility with
`lib/projection.ts` and the committed fixture.)

The reference implementation of canonicalization and the substantive hash is
`tools/canonical-hash.mjs` (coordinator-owned shared infrastructure). WS-1 and
WS-2 must use it — or match it exactly — so client and server hashing cannot
drift. Its behavior is locked by `tools/tests/canonical-hash.test.mjs`.

Values with no JSON representation — `undefined`, `NaN`, `Infinity`,
`-Infinity`, functions, `BigInt`, circular references — are invalid anywhere in
the payload and are rejected with 400 `invalid_schema` **before** hashing.
(Server-side this is guaranteed by parsing the raw JSON body; the companion must
guarantee it before serializing.)

**The server always recomputes the hash** from the received `data` using this
canonicalization. A mismatch between the recomputed hash and the envelope's
`payloadHash` is rejected with 400 `invalid_schema`. The server uses **its own
recomputed hash** — never the client-asserted value — for idempotency
comparison (§6) and for storage in `{key}-meta`.

---

## 2. Data schemas by endpoint

### 2a. `POST /api/ingest/obsidian` — Obsidian projection

The `data` field must contain exactly:

```typescript
{
  generatedAt: string;           // ISO 8601 — kept for backward compat with lib/projection.ts
  concepts: Array<{
    id:        string;
    title:     string;
    kind:      string;
    category:  string;
    summary:   string;
    presentIn: string[];
    backlinks: number;
  }>;
  connections: Array<{
    from: string;
    to:   string;
  }>;
  emerging: Array<{
    term:       string;
    references: number;
  }>;
}
```

- `concepts` must contain at least one entry. Empty array is rejected with 400.
- `id` values must be slug-style strings (no spaces, no `.md`, no vault paths).
- `summary` must be a short human-readable string. No note body. Max 500 chars.
- `presentIn` contains Studio environment slugs: `"today"`, `"field"`, `"formation"`,
  `"iteration"`, `"distribution"`, `"memory"`. Unknown slugs are tolerated (ignored).
- Unknown fields inside `data` or inside any array element are rejected with 400.
  In particular, a `source` field inside `data` is rejected — source/provenance
  lives only in the transport envelope. (The committed fallback fixture
  `data/projections/obsidian.json` may carry a legacy `source` key; readers
  tolerate unknown fixture fields per §12, but it is never submitted.)

Redis keys written: `obsidian-projection`, `obsidian-projection-meta`, `obsidian-projection-prev`.

---

### 2b. `POST /api/ingest/editorial-board` — Editorial Board projection

The `data` field must contain exactly:

```typescript
{
  manuscript: {
    id:          string;
    title:       string;
    reviewRound: number;
    status:      "in review" | "awaiting ruling" | "complete";
  };
  reviewedAt:   string;           // ISO 8601
  reviewers: Array<{
    role:           string;
    diagnosis:      string;       // max 500 chars
    recommendation: string;       // max 500 chars
    confidence:     "high" | "medium" | "low";
  }>;
  unresolvedQuestions: string[];  // each max 300 chars
  rulings: Array<{
    on:       string;             // max 300 chars
    decision: string;             // max 500 chars
  }>;
  nextDecision:  string;          // max 300 chars
  sourceLabel:   string;          // e.g. "Claude Editorial Board · automated"
  updatedAt:     string;          // ISO 8601
  updatedBy:     "claude" | "human";
}
```

- `reviewers` must contain at least one entry.
- No manuscript body text. Diagnosis and recommendation are diagnostic summaries only.
- No private transcript text.
- Unknown fields inside `data` are rejected with 400.

**Rulings rule (v1 — authority boundary).** This endpoint rejects **every
payload whose `rulings` array is non-empty, regardless of `updatedBy`**
(400 `invalid_schema`). Rationale: `updatedBy` is payload content asserted by
whatever session produced the artifact — the sync secret authenticates the
companion, not the human authorship of a field. Human authorship must be
established by the **write path**, not asserted by payload content.

- `updatedBy` is **provenance metadata only** — never authorization or
  attestation.
- Automated Editorial Board output always carries `rulings: []`. Reviewer
  `recommendation`s remain advice; `nextDecision` may describe what needs the
  human's judgment, but no field may imply a decision the human did not
  explicitly make.
- The `rulings` field remains in the schema for forward compatibility. Live
  human rulings are out of scope until a genuinely human-authorized write path
  exists (e.g. an authenticated Studio UI action with explicit confirmation);
  introducing one is a contract change requiring a version bump.
- The committed fallback fixture's rulings are human-curated legacy data and
  may remain; the UI must present live board content as advice and may present
  rulings as human decisions only from that human-curated source.

Redis keys written: `editorial-board`, `editorial-board-meta`, `editorial-board-prev`.

---

### 2c. `POST /api/ingest/workspace-signals` — Workspace inferred state (WS-4)

The `data` field must contain exactly:

```typescript
{
  kind:                    "inferred";
  activeManuscript: {
    id:    string | null;
    title: string | null;
    round: number | null;
    venue: string | null;
  } | null;
  approvedFormationTopic:  string | null;
  openQuestions:           string[];
  status:                  "active" | "paused" | "resting" | null;
  updatedAt:               string;   // ISO 8601
  updatedBy:               "claude";
}
```

Redis keys written: `workspace-inferred`, `workspace-inferred-meta`.

---

### 2d. `POST /api/ingest/workspace-override` — Workspace human override (WS-4)

The `data` field must contain exactly:

```typescript
{
  kind:                    "override";
  activeManuscript: {
    id:    string | null;
    title: string | null;
    round: number | null;
    venue: string | null;
  } | null;
  approvedFormationTopic:  string | null;
  openQuestions:           string[];
  todayNote:               string | null;   // max 300 chars
  nextAction:              string | null;   // max 300 chars
  paused: Array<{
    id:   string | null;
    note: string | null;
  }>;
  status:                  "active" | "paused" | "resting" | null;
  updatedAt:               string;   // ISO 8601
  updatedBy:               "human";
}
```

Redis keys written: `workspace-override`, `workspace-override-meta`.

---

### 2e. `GET /api/sync-status` — Sync status (no payload required)

Returns the current sync status for all tracked keys.

```typescript
{
  keys: {
    "obsidian-projection": {
      lastSuccessfulSync: string | null;  // ISO 8601 or null
      lastAttempt:        string | null;
      revision:           number | null;
      payloadHash:        string | null;
      error:              string | null;
    };
    "editorial-board": { ... };    // same shape
    "workspace-inferred": { ... }; // same shape (WS-4)
    "workspace-override": { ... }; // same shape (WS-4)
  };
}
```

No authentication required. No secrets in response.

Behavior rules:

- `GET` only; other methods return 405. The route is `force-dynamic` and sets
  `Cache-Control: no-store`.
- **Redis unavailable:** return 200 with `degraded: true` at the top level and
  `null` metadata values — never a 5xx, never internal error details.
- **Never synced** (Redis reachable, key absent) is distinguishable from
  **status unavailable** (Redis unreachable): the former is `degraded: false`
  with `null` values for that key; the latter is `degraded: true`.
- The `error` field per key carries a short category string only — never stack
  traces, connection strings, paths, or credentials.

```typescript
{
  degraded: boolean;   // true when Redis itself could not be reached
  keys: { ... };       // as above; per-key values null when unknown
}
```

---

## 3. Authentication contract

All write endpoints (`POST /api/ingest/*`) require:

```
Authorization: Bearer <STUDIO_SYNC_SECRET>
```

Rules:
- If `STUDIO_SYNC_SECRET` is absent from the server environment, all write
  endpoints return 500 and log an internal error. They do not fall back to
  unauthenticated access.
- Secret comparison uses constant-time byte comparison (`crypto.timingSafeEqual`)
  to prevent timing attacks, with **length-safe handling**: first validate the
  header shape (`Authorization: Bearer <token>`, missing/malformed → 401);
  convert token and secret to buffers; if the byte lengths differ, return 401
  without calling `timingSafeEqual` (it throws on unequal lengths) — e.g. by
  comparing the token against an equal-length dummy or checking lengths first.
  Every credential failure returns the identical 401 `auth_failed` response.
- The secret value must not appear in any log line, error response, or HTTP header
  beyond the one Authorization header the companion sends.
- Rotating the secret: update `STUDIO_SYNC_SECRET` in Vercel environment variables
  and in `~/.config/uxistentialism-studio/config.json`, then restart the companion.
  Both must be updated before the next sync.

---

## 4. Payload size and content-type rules

- `Content-Type: application/json` is required. Requests with any other
  content type are rejected with 415 before reading the body.
- `Content-Length` must be present, well-formed, and non-negative. A missing,
  malformed, or negative header, or a declared size over 512KB, is rejected
  with 413 before reading the body.
- **Actual bytes are enforced, not just the header.** The body is read as a
  bounded stream (or bounded text read); if the actual received bytes exceed
  512KB — regardless of the declared `Content-Length` — the request is
  rejected with 413. The server must never call `request.json()` on an
  unbounded body after checking only the header.
- Only `POST` is accepted at ingestion endpoints. Other methods return 405.

---

## 5. Unknown-field rejection

The server runs strict schema validation before any Redis write:
- Unknown top-level envelope fields → 400.
- Unknown fields inside `data` or any nested object → 400.
- Missing required fields → 400.
- Wrong types → 400.

The companion runs the same validation locally before sending. A payload that
passes local validation and fails server validation indicates a contract drift
and must be surfaced as an error, not silently retried.

---

## 6. Stale-write and duplicate-write policy (atomic)

The stale/duplicate comparison and the Redis mutation are **one atomic
operation**. The server must not use a read-then-write sequence: concurrent
requests could both pass validation and overwrite one another, and data, meta,
and the `-prev` backup could diverge after a partial failure.

**Required implementation:** a single Redis `EVAL` (Lua) script — supported by
Upstash REST and exposed as `.eval()` in `@upstash/redis` — invoked with keys
`{key}`, `{key}-meta`, `{key}-prev`. Inside one atomic execution the script:

1. reads the stored `revision`, `projectedAt` (epoch ms), and `payloadHash`
   from `{key}-meta`;
2. on `idempotent` (recomputed **substantive** hash, §1b, matches stored hash):
   atomically refreshes the server-owned `lastSuccessfulSync` heartbeat in
   `{key}-meta` to server time, leaving the stored data (including its original
   `generatedAt`), `payloadHash`, `sourceUpdatedAt`, `projectedAt`, `revision`,
   and `{key}-prev` unchanged, then returns `idempotent` — the incoming run's
   fresh `generatedAt`/`projectedAt` are discarded;
3. on `stale` or `duplicate`: returns without any mutation;
4. otherwise copies the current `{key}` value to `{key}-prev` and writes the
   new data and meta **together**, then returns `accepted`.

Timestamps are validated against the exact format in §1 and converted to
**epoch milliseconds** before being passed into the script; all ordering
comparisons are numeric. The hash used is the server's recomputed hash (§1b).

| Condition (evaluated atomically) | Result | HTTP response |
|---|---|---|
| Recomputed **substantive** hash (§1b) matches stored hash | No data write. **Heartbeat refresh only** (`lastSuccessfulSync` ← server time). | 200 `{ ok: true, status: "idempotent" }` |
| Incoming `projectedAt` < stored `projectedAt` | No write. | 409 `{ error: "stale_payload", ... }` |
| Incoming `revision` ≤ stored `revision` AND `projectedAt` ≠ stored | No write. | 409 `{ error: "duplicate", ... }` |
| All checks pass | Backup + write data and meta together (`lastSuccessfulSync` ← server time). | 200 `{ ok: true, status: "accepted" }` |

**Freshness rule.** `lastSuccessfulSync` means *the most recent successful
synchronization — accepted or idempotent*. A fully authenticated, schema-valid,
hash-valid idempotent submission proves the companion verified the current
state, so it refreshes the heartbeat. Consequently, unchanged data that the
companion reconciles every 6 hours **never becomes operationally stale**:
`stale` signals lost connectivity, not lack of change. Data/source age and
connectivity are distinct dimensions (§10): `sourceUpdatedAt` = age of the
contributing vault state, `projectedAt` = when that projection was generated,
`lastSuccessfulSync` = when the server most recently verified a valid companion
submission. A contract-semantics test for this rule lives at
`tools/tests/contract-freshness.test.mjs`; the WS-1 implementation must satisfy
it.

**Client semantics (companion):**

- 200 `idempotent` is a **success**: the server already holds this exact
  payload. Update `lastSuccess` normally.
- 409 `stale_payload` and 409 `duplicate` are **non-retryable conflicts**: do
  not retry the same payload, do not record `lastSuccess`, and surface the
  conflict in visible status. Recover the revision sequence from the
  `storedRevision` in the error response (next submission uses
  `storedRevision + 1` with a fresh projection).

The server does not call `revalidatePath`. Pages use `export const dynamic =
"force-dynamic"` and read from Redis on every request. There is no route cache
to invalidate.

---

## 7. Redis key registry and ownership

| Key | Owner | Backed up to | Description |
|---|---|---|---|
| `obsidian-projection` | WS-1 companion pipeline | `obsidian-projection-prev` | Sanitized concept graph from vault |
| `obsidian-projection-meta` | WS-1 | — | Envelope metadata for the above |
| `obsidian-projection-prev` | WS-1 | — | Previous value (one-level rollback) |
| `editorial-board` | WS-1 endpoint writes · WS-2 companion submits · WS-3 board skill supplies data | `editorial-board-prev` | Board snapshot |
| `editorial-board-meta` | WS-1 endpoint | — | Envelope metadata for the above |
| `editorial-board-prev` | WS-1 endpoint | — | Previous value (one-level rollback) |
| `workspace-inferred` | WS-4 companion pipeline | — | Vault-derived workspace signals |
| `workspace-inferred-meta` | WS-4 | — | Envelope metadata for the above |
| `workspace-override` | WS-4 Studio UI | — | Explicit human overrides |
| `workspace-override-meta` | WS-4 | — | Envelope metadata for the above |

Only the ingestion endpoints write to Redis. `lib/*.ts` read from Redis; they
never write.

---

## 8. Live-versus-fallback read contract

Every lib function that reads from Redis returns a typed result:

```typescript
interface DataResult<T> {
  data: T;
  source: "live" | "fallback" | "default";
  lastSuccessfulSync: string | null;  // ISO 8601 from {key}-meta, or null
  stale: boolean;                     // true if lastSuccessfulSync > 24h ago or null
  error: string | null;               // internal error if Redis failed; never a secret
}
```

| `source` value | Meaning |
|---|---|
| `"live"` | Data came from Redis successfully |
| `"fallback"` | Redis failed or returned empty; data from committed JSON fixture in `data/` |
| `"default"` | Neither Redis nor fixture available; data from `lib/content.ts` curated defaults |

The Studio UI must render a visible provenance indicator on each page reflecting
the `source` and `lastSuccessfulSync` values. Stale or fallback data must be
distinguishable from live data. Silent degradation is not permitted.

`stale` threshold defaults to 24 hours. The companion's periodic reconciliation
interval (default 6 hours) ensures the threshold is not reached under normal
operation — including when the vault is unchanged, because idempotent
reconciliations refresh the `lastSuccessfulSync` heartbeat (§6). Staleness
therefore indicates a connectivity problem, never merely an idle vault.

**Client construction rule.** The Redis client must be a lazy, guarded,
server-only accessor. Missing or malformed Redis configuration is an explicit
fallback condition (`source: "fallback"`), never a module-initialization crash:
pages must remain renderable from fixtures with no Redis env vars present.

**Snapshot rule.** Each page request loads **one** `DataResult<T>` snapshot per
data source and derives every view (concepts, graph, graph details, emerging,
etc.) from that single snapshot, with one metadata read. Derived views must not
independently re-fetch, or one response could mix different snapshots and
report inconsistent provenance. No module-scope data reads: all reads happen
inside request-time functions.

**Workspace boundary (WS-1/WS-4).** During WS-1, Workspace does not read from
Redis: `lib/workspace.ts` keeps its fixture/default read path, wrapped in
`DataResult` with honest `source: "fallback" | "default"`. The
`workspace-inferred` / `workspace-override` merge (human overrides authoritative
per field) is WS-4 scope. No other workspace Redis key may be introduced.

---

## 9. Error response format

All error responses use this structure:

```typescript
{
  ok: false;
  error: "auth_failed" | "stale_payload" | "duplicate" | "invalid_schema"
       | "oversized" | "wrong_method" | "wrong_content_type" | "server_error";
  message: string;               // human-readable; never contains secrets or paths
  storedRevision?: number;       // present for stale_payload, duplicate
  storedProjectedAt?: string;    // present for stale_payload, duplicate
}
```

HTTP status codes:

| Error | Status |
|---|---|
| `auth_failed` | 401 |
| `stale_payload` | 409 |
| `duplicate` | 409 |
| `invalid_schema` | 400 |
| `oversized` | 413 |
| `wrong_method` | 405 |
| `wrong_content_type` | 415 |
| `server_error` | 500 |

---

## 10. Provenance and timestamp meanings

| Timestamp | Meaning | Set by |
|---|---|---|
| `sourceUpdatedAt` | Newest mtime among **every scanned (non-skipped) vault note** — not only allowlisted notes, because non-allowlisted notes contribute to backlink and emerging reference counts. A single timestamp; no note identities, paths, or per-note mtimes are exposed. If zero notes are scanned, the projector errors and nothing is submitted. For inbox artifacts, the source-event timestamp supplied with the data. | Companion (via the projector library) |
| `projectedAt` | When the companion ran the projection and generated this payload | Companion |
| `lastSuccessfulSync` | When the server most recently verified a valid companion submission — **accepted or idempotent** (heartbeat, §6) | Server (in `{key}-meta`) |
| `stale` | Whether `lastSuccessfulSync` is more than 24h ago | `lib/*.ts` at read time |

`lastSuccessfulSync` and `sourceUpdatedAt` are not the same. The UI should
express "synced 3 min ago" (from `lastSuccessfulSync`) and separately "vault
file last changed at [time]" (from `sourceUpdatedAt`) when both are meaningful.

---

## 11. Recovery and rollback

**Primary recovery:** Running "Sync Now" on the companion re-projects the current
vault state and submits a fresh payload. This is always authoritative.

**One-level rollback:** Each key's previous value is stored at `{key}-prev`.
To rollback: read `{key}-prev` from Redis (via Upstash console or a recovery
script), increment `revision` and update `projectedAt`, and POST the result to
the ingestion endpoint. The server will accept it as a newer payload.

**Redis unavailable:** Studio reads from committed fallback fixtures in `data/`.
These files must not be deleted. The Studio remains usable but shows
`source: "fallback"` in the provenance indicator.

**Companion offline:** Redis retains the last accepted payload. The Studio
continues to serve live data from Redis until the `stale` threshold (24h) is
crossed, at which point it shows `stale: true`. No data is lost.

**Corrupted payload accepted:** Use the rollback procedure. Then investigate what
the companion generated and fix the root cause before re-enabling sync.

---

## 12. Compatibility and schema-versioning rules

- `schemaVersion: 1` is the current version.
- **Operative rule:** the server accepts only `schemaVersion` values for which
  it has a registered validator — today, **exactly `1`**. Every other value
  (higher, lower, non-integer) is rejected with 400. Version-specific
  validators are added only when a second version actually exists; "accepts ≤
  maximum" describes the forward-compatibility *intent*, not a license to pass
  old versions through the latest validator.
- A breaking change (removed required field, type change, key rename) requires
  incrementing `schemaVersion`. Both the companion and the server must be updated
  and deployed in coordination before the new version is used in production.
- A non-breaking addition (new optional field) does not require a version bump,
  but must be documented here before shipping.
- The companion always sends the highest `schemaVersion` it supports.
- The committed fallback fixtures (`data/projections/*.json`) do not carry
  `schemaVersion` in their current form and are exempt from this policy.
  They are treated as unversioned fallback data: readers select the fields they
  know and tolerate unknown fixture fields (e.g. a legacy `source` key).
  Strict unknown-field rejection applies to **submitted payloads only**.

---

*End of Ingestion Contract v1.0.0*
