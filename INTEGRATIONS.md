# Integrations

How the Studio connects to the wider ecosystem. The governing rule: **the app
only ever reads sanitized projections — never a live source — and only ever
writes to destinations with human approval.**

## Sources → Projections → Destinations

```
   SOURCES                 PROJECTIONS                STUDIO              DESTINATIONS
(hold truth, read-only)  (sanitized flat files,     (reads projections   (write-only, approved)
                          committed, reversible)      only)
┌──────────────┐  generate  ┌────────────────────┐  read  ┌──────────┐  approve+push  ┌─────────┐
│ Obsidian vault├──────────►│ data/projections/  ├───────►│ 6 modes  ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌►│ Medium   │
│  (source of   │ (offline,  │  obsidian.json     │        │          │   (deferred)   │ Substack │
│   truth)      │  sanitize) │  (metadata only)   │        │          │                │ …        │
└──────────────┘            └────────────────────┘        └──────────┘                └─────────┘
```

- **Source** — holds truth the Studio reads; never mutated by the Studio.
- **Projection** — a generated, sanitized, flat-file snapshot of a source,
  committed to the repo. The app reads *only* projections, never a live source.
  Delete it → the app falls back to curated data. This is the safety membrane.
- **Destination** — a system the Studio eventually writes into (publishing);
  write-capable, human-approved, all deferred.

## Current state

| System | Role | Access | Status |
|---|---|---|---|
| **Obsidian vault** | Source | Read-only | **live** |
| **Sanitized projection** | Projection | App reads at build | **live** |
| Medium | Source (read) / Destination (publish) | — | **deferred** |
| Claude agents (field/synthesis) | Service | — | deferred |
| Claude editorial board | Service | — | deferred |
| Schedules / automations | Service | — | deferred |
| Substack / LinkedIn / X | Destination | — | deferred |
| Obsidian write-back | Destination | — | deferred (most guarded) |

## Obsidian connector (the one that's live)

- **Generator:** `integrations/obsidian/project.mjs` — offline, reads the live
  vault **read-only** (reuses the audit tool's `_shared.mjs`), emits
  `data/projections/obsidian.json`.
- **Privacy gate:** `integrations/obsidian/allowlist.json` — only listed items
  are projected, and only metadata: `title / kind / category / summary /
  presentIn` plus vault-derived `backlinks`, `connections` (allowlisted ↔
  allowlisted only), and `emerging` (term + reference count). **Never note
  bodies, private notes, or the vault path.**
- **App reader:** `lib/projection.ts` — reads the projection at build time and
  **falls back to `lib/content.ts`** when it is absent (reversible). Powers the
  Field graph (concepts + connections + backlink counts), Formation's
  "still forming" list (referenced-but-missing concepts), and Memory's canon +
  emerging shoots. Memory's phase lineage remains **hand-authored** and is
  labeled as such in the UI.

### Refresh

```
node integrations/obsidian/project.mjs   # after curating allowlist.json
# review data/projections/obsidian.json, then commit
```

## Principles

Obsidian stays the source of truth · no private/body content in the public repo ·
no write-back to Obsidian · no database (flat-file projections) · every
integration reversible · product decisions lead, infrastructure follows.
