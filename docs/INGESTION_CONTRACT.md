# UXistentialism Studio — Ingestion Contract

Version: 1.0.0 · 2026-07-11

This document is the authoritative specification for every payload the local
Studio Sync companion sends to the hosted Studio, and for every payload the
hosted Studio stores in Upstash Redis. Both the companion and the server must
implement this contract identically.

Any change to schemas, key names, authentication rules, or versioning policy
requires a new contract version and coordinated updates to the companion and
the server before deployment.

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

### Envelope field definitions

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | integer | yes | Contract version. Currently `1`. |
| `source` | string | yes | Who sent this payload. See allowed values below. |
| `sourceUpdatedAt` | ISO 8601 UTC | yes | Latest mtime of source files that contributed to this payload. Not when the companion ran. |
| `projectedAt` | ISO 8601 UTC | yes | When the companion generated and validated this payload. |
| `revision` | integer ≥ 1 | yes | Monotonically increasing per endpoint, tracked in companion status file. |
| `payloadHash` | string | yes | `sha256-` prefix followed by hex SHA-256 of the serialized `data` field only. |
| `data` | object | yes | Payload body. Schema varies by endpoint. |

### Allowed `source` values

| Value | Meaning |
|---|---|
| `"companion"` | Local Studio Sync companion (Obsidian or workspace signals) |
| `"editorial-board-inbox"` | Editorial Board output dropped into the watched inbox |
| `"studio-ui"` | Workspace override submitted from within the Studio (WS-4) |

Unknown top-level fields are rejected with 400.

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
  to prevent timing attacks.
- The secret value must not appear in any log line, error response, or HTTP header
  beyond the one Authorization header the companion sends.
- Rotating the secret: update `STUDIO_SYNC_SECRET` in Vercel environment variables
  and in `~/.config/uxistentialism-studio/config.json`, then restart the companion.
  Both must be updated before the next sync.

---

## 4. Payload size and content-type rules

- `Content-Type: application/json` is required. Requests with any other
  content type are rejected with 415 before reading the body.
- `Content-Length` must be present and must not exceed 512KB. Requests
  without a Content-Length header, or with Content-Length > 512KB, are
  rejected with 413 before reading the body.
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

## 6. Stale-write and duplicate-write policy

Before writing to Redis, the server reads `{key}-meta` for the stored
`projectedAt`, `revision`, and `payloadHash`.

| Condition | Server action | HTTP response |
|---|---|---|
| `payloadHash` matches stored hash | No write. Idempotent accept. | 200 `{ ok: true, status: "idempotent" }` |
| Incoming `projectedAt` < stored `projectedAt` | No write. | 409 `{ error: "stale_payload", ... }` |
| Incoming `revision` ≤ stored `revision` AND `projectedAt` ≠ stored | No write. | 409 `{ error: "duplicate", ... }` |
| All checks pass | Backup current data to `{key}-prev`. Write new data and meta. | 200 `{ ok: true, status: "accepted" }` |

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
| `editorial-board` | WS-1/WS-3 inbox pipeline | `editorial-board-prev` | Board snapshot |
| `editorial-board-meta` | WS-1/WS-3 | — | Envelope metadata for the above |
| `editorial-board-prev` | WS-1/WS-3 | — | Previous value (one-level rollback) |
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
operation.

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
| `sourceUpdatedAt` | Latest mtime of vault source files contributing to this payload | Companion |
| `projectedAt` | When the companion ran the projection and generated this payload | Companion |
| `lastSuccessfulSync` | When the server last accepted and stored a payload | Server (in `{key}-meta`) |
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
- The server accepts any `schemaVersion` ≤ its supported maximum.
- The server rejects `schemaVersion` greater than its supported maximum with 400.
- A breaking change (removed required field, type change, key rename) requires
  incrementing `schemaVersion`. Both the companion and the server must be updated
  and deployed in coordination before the new version is used in production.
- A non-breaking addition (new optional field) does not require a version bump,
  but must be documented here before shipping.
- The companion always sends the highest `schemaVersion` it supports.
- The committed fallback fixtures (`data/projections/*.json`) do not carry
  `schemaVersion` in their current form and are exempt from this policy.
  They are treated as unversioned fallback data.

---

*End of Ingestion Contract v1.0.0*
