# CLAUDE.md — UXistentialism Studio

This file is the shared operating constitution for every automated worker session
in this repository. Read it fully before writing any code.

---

## Product goal

The Studio removes recurring cognitive and operational work surrounding Pegah's
intellectual practice. It observes automatically, synchronizes automatically, and
maintains awareness automatically. It acts proactively when confidence is
sufficient. It interrupts rarely. It preserves visible provenance. It never makes
consequential commitments on Pegah's behalf.

Human work is reserved for: observation, judgment, creation, rulings, publishing
approval, and changes to authoritative sources.

---

## Architecture

```
Obsidian vault (read-only source of truth)
  │
  │  watched by
  ▼
Local Studio Sync companion (Mac daemon)
  │  generates sanitized projection
  │  validates (public-safety rules)
  │  submits authenticated payload
  ▼
POST /api/ingest/* (hosted on Vercel)
  │  re-validates payload on server
  │  writes to Upstash Redis
  │  returns 200 | 4xx | 5xx
  ▼
Upstash Redis (private mutable data store)
  │
  │  read at request time by
  ▼
Studio server components (lib/*.ts)
  │  fallback: committed JSON fixtures in data/
  │  fallback: lib/content.ts curated defaults
  ▼
Studio UI (six environments: Today, Field, Formation,
           Iteration, Distribution, Memory)
  │
  ▼
Destinations (deferred, write-only, human-approved)
```

GitHub transports application code only. It is not part of the daily data path.
Vercel deploys application code only. Routine Obsidian, Workspace, and Editorial
Board updates do not require a Git commit, a push, or a redeployment.

---

## Production deployment

- GitHub repository: `https://github.com/pegahmadi/uxistentialism-studio`
- Branch deployed: `main`
- Hosting: Vercel
- Production URL: `[STUDIO_URL]` — replace this placeholder with the confirmed
  URL before WS-1 begins implementation.

Deployment-state note (2026-07-12): local `main` is ahead of GitHub `main`,
which does not yet contain this file or the ingestion contract. Before any
deployed testing: confirm the **existing** Vercel project and its production
URL and deploy branch (never create a second project), push the reviewed local
`main`, connect Upstash through that project, set `STUDIO_SYNC_SECRET`, and
verify the deployed commit is the intended WS-1 merge.

---

## What automated workers may do

- Read any file in this repository.
- Write to their assigned paths as listed in the workstream ownership table below.
- Create new files inside their worktree.
- Commit changes in their own branch.
- Add `@upstash/redis` and `chokidar` as npm dependencies (WS-1 and WS-2 only).

---

## What automated workers must never do

- Write to the Obsidian vault (`~/Desktop/Obsidian-UXistentialism/`).
- Modify `VAULT_PROTOCOL.md` without Pegah's explicit approval.
- Initialize Git in the Obsidian vault.
- Store note bodies, vault paths, private transcripts, or credentials in Redis,
  in committed files, or in any log.
- Commit to `main` directly. All changes go through a named workstream branch.
- Create a second Vercel project.
- Push to GitHub. Pegah reviews all diffs before merging or pushing.
- Delete `data/projections/obsidian.json`, `data/projections/editorial-board.json`,
  or `data/studio/workspace.json` — these are fallback fixtures and must remain.
- Make consequential commitments (publish, send, deploy) on Pegah's behalf.

---

## Workstream ownership and allowed files

| Workstream | Branch | May modify or create |
|---|---|---|
| WS-0 | `ws/claude-md` (merged) | `CLAUDE.md`, `docs/INGESTION_CONTRACT.md` |
| Coordinator | `ws/contract-amendments` | `CLAUDE.md`, `docs/INGESTION_CONTRACT.md`, shared infrastructure (`integrations/`, `tools/`), and — as a documented exception — `WORKSTREAM.md` and `PLAN.md` briefs on the WS branches |
| WS-1 | `ws/live-data` | `lib/`, `app/`, `tests/ws1/`, `package.json`, `next.config.ts` |
| WS-2 | `ws/companion` | `companion/` |
| WS-3 | `ws/editorial-board-output` | Editorial Board skill (external), `docs/EDITORIAL_BOARD_OUTPUT.md` |
| WS-4 | `ws/workspace-inference` | `companion/workspace-signals.mjs`, `app/api/ingest/workspace-signals/`, `lib/workspace.ts` (extension only) |

No workstream may modify files owned by another workstream without explicit
cross-workstream coordination documented in both WORKSTREAM.md files.

The reusable Obsidian projector (`integrations/obsidian/project.mjs` and the
shared loader in `tools/vault-audit/_shared.mjs`) is **shared infrastructure**
maintained by the Coordinator. Implementation workstreams import it; they never
modify it. WS-2 calls the pure `project({ vaultPath })` function — which throws
instead of exiting and writes nothing — and owns the full transport envelope
(`schemaVersion`, `source`, `projectedAt`, `revision`, `payloadHash`) for every
submission, including inbox artifacts.

**Workspace boundary:** during WS-1, `lib/workspace.ts` keeps its
fixture/default read path (honest `source: "fallback" | "default"` provenance).
The `workspace-inferred` / `workspace-override` Redis merge is WS-4 scope; no
other workspace Redis key may be introduced.

---

## Redis key registry

See `docs/INGESTION_CONTRACT.md` for full schemas.

| Key | Written by | Read by |
|---|---|---|
| `obsidian-projection` | WS-1 ingestion endpoint | `lib/projection.ts` |
| `obsidian-projection-meta` | WS-1 ingestion endpoint | `/api/sync-status` |
| `obsidian-projection-prev` | WS-1 ingestion endpoint (backup) | Recovery only |
| `editorial-board` | WS-1 ingestion endpoint | `lib/editorial-board.ts` |
| `editorial-board-meta` | WS-1 ingestion endpoint | `/api/sync-status` |
| `editorial-board-prev` | WS-1 ingestion endpoint (backup) | Recovery only |
| `workspace-inferred` | WS-4 ingestion endpoint | `lib/workspace.ts` |
| `workspace-override` | WS-4 Studio UI endpoint | `lib/workspace.ts` |

---

## Public-safety rules

The following must never appear in **runtime payloads, Redis values, public
projection fixtures (`data/`), or logs**:

- Note bodies or manuscript text
- Private filesystem paths or source filenames (vault paths, `/Users/...`,
  `.md` note filenames)
- Private review transcripts
- Credentials, tokens, or secrets

Documentation examples, local configuration templates, and gitignored config
files (e.g. `tools/vault-audit/audit.config.json`,
`~/.config/uxistentialism-studio/config.json`) may reference local paths — they
are operator documentation, not submitted intellectual data. The boundary is:
nothing private travels in a payload, lands in Redis, sits in a public fixture,
or is written to a log.

The projection generator (`integrations/obsidian/project.mjs`) and the validator
(`tools/validate-projection.mjs`) enforce these rules locally. The ingestion
endpoint enforces them again on the server.

---

## `updatedBy` convention

Every stored payload carries `updatedBy: "human" | "claude"`. The Studio UI
surfaces this in the provenance display. Automated workers set `"claude"`.
Pegah's direct edits set `"human"`. Human overrides take precedence per field
when inferred and override states are merged (WS-4).

---

## Data sources and their roles

| Source | Role | Mutability |
|---|---|---|
| Obsidian vault | Authoritative intellectual content | Read-only to the Studio |
| Upstash Redis | Live mutable Studio state | Written by ingestion endpoints only |
| `data/projections/*.json` | Emergency fallback fixtures | Never auto-generated after WS-1 ships |
| `data/studio/workspace.json` | Migration source for WS-4 | Deprecated as primary interface after WS-4 |
| `lib/content.ts` | Hand-curated defaults | Human-authored only |

---

## Six Studio environments

Today, Field, Formation, Iteration, Distribution, and Memory are cognitive
contexts, not pipeline stages. They represent different time relationships to
the work. No implementation should reframe them as a production pipeline.

---

## Editorial Board

The UXistentialism Editorial Board v2.1 is a manuscript-review system with
specialized reviewer roles orchestrated by an Editor-in-Chief. It advises;
Pegah decides. Board output enters the Studio through the private watched inbox
folder (`~/.studio-inbox/`), not through direct API calls that would distribute
the sync secret to general-purpose Claude sessions. There is no direct-POST
fallback: if the companion is offline, artifacts wait in the inbox and are
drained when it restarts.

**Authority rule (v1):** the Editorial Board ingestion endpoint rejects every
payload with a non-empty `rulings` array, regardless of `updatedBy`.
`updatedBy` is provenance metadata, never authorization — human authorship is
established by the write path, not asserted by payload content. Automated board
output always carries `rulings: []`; reviewer recommendations remain advice;
the UI never presents automated content as a human decision. For the same
reason the endpoint also rejects `manuscript.status: "complete"` on every live
submission — completion is human-attested state, and the server independently
enforces this rather than trusting upstream layers ("awaiting ruling" is
acceptable: it names unresolved judgment, claiming no decision). Live human
rulings and live "complete" state await a genuinely human-authorized write path
(a future, versioned contract change).

---

## Ingestion contract

Full payload schemas, authentication, stale-write policy, error format, and
Redis key ownership: see `docs/INGESTION_CONTRACT.md`.

---

## Last updated

2026-07-12 · updatedBy: claude (coordinator amendments after independent audit)
reviewedBy: human — pending review (addendum v1.1.1 under review; prior
amendments through 00e9fe3 were approved 2026-07-12)

(Provenance is honest by the project's own rule: these amendments were authored
by Claude at Pegah's direction. `updatedBy` never converts automated authorship
into human authorship; `reviewedBy` becomes `human · <date>` only after Pegah
explicitly approves the amendment diff.)
