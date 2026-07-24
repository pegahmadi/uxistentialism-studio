# WS-Field-Research → Coordinator: routing proposal

Status: **routing unimplemented — stopped per WORKSTREAM.md boundary rules.**
Approved findings are staged locally (browser `localStorage`,
`uxi-field-research-v1`) and the UI marks the routing step unimplemented in
plain language. This document is the "smallest possible proposed change"
the brief asked for.

---

## Why routing stopped

Frozen scope item 5 requires approved findings to be routed "through the
existing companion boundary." No existing mechanism is semantically correct:

1. **There is no field-research ingestion endpoint or schema.** The contract
   defines §2a (obsidian), §2b (editorial-board), §2c/§2d (workspace, WS-4).
   Nothing carries field findings.
2. **The inbox cannot carry them either.** The WS-2 inbox watcher submits
   *every* direct-child `*.json` artifact through the §2b validator to the
   editorial-board endpoint (`companion/inbox-watcher.mjs`). A field-research
   artifact dropped in `~/.studio-inbox/` would be quarantined in `rejected/` —
   or worse, if shaped to pass, stored under Editorial Board provenance. The
   editorial-board endpoint's provenance is pinned (`source:
   "editorial-board-inbox"`, `sourceLabel: "Claude Editorial Board ·
   automated"`, §2b v1.1.2); reusing it for field findings would be a false
   provenance claim. Excluded by the brief, and rightly.
3. **The approver and the boundary are on different machines.** Approval must
   be established by the write path — Pegah clicking approve (WORKSTREAM.md
   boundary rules). That click happens in the hosted Studio UI (Vercel). The
   companion boundary (`~/.studio-inbox/`) is on the local Mac. A browser
   cannot write to that inbox, and the UI must never hold `STUDIO_SYNC_SECRET`
   to POST directly.

Any resolution is therefore a contract change, which this workstream excludes.

---

## Smallest proposed change (recommendation)

**A new §2f endpoint: `POST /api/ingest/field-approvals`, envelope `source:
"studio-ui"`, Redis keys `field-approved` / `field-approved-meta`.**

- `"studio-ui"` is already a reserved envelope `source` value ("Workspace
  override submitted from within the Studio (WS-4)" — its description widens
  slightly; the enum itself does not grow).
- `data` (strict, unknown fields rejected, public-safety scan §5 applies):

  ```typescript
  {
    kind: "field-approvals";
    approved: Array<{
      id:         string;        // finding id (slug)
      title:      string;        // max 300 chars
      summary:    string;        // max 500 chars
      source:     { title: string; url: string };  // https:// URL or explicit sample origin
      relevance:  "high" | "medium" | "low";
      confidence: "high" | "medium" | "low";
      approvedAt: string;        // ISO 8601
    }>;
    updatedAt: string;           // ISO 8601
    updatedBy: "human";          // provenance metadata, NOT authorization (see below)
  }
  ```

- **Approval is established by the write path, not payload content**, exactly
  like the §2b rulings rule: this endpoint is only callable through an
  authenticated Studio-UI action. `updatedBy: "human"` remains display
  metadata. Dismissals never travel — only approved findings, and only because
  Pegah clicked approve.
- The full §6 atomic stale/duplicate machinery, §1 envelope, and §9 errors
  apply unchanged.

**Open dependency the Coordinator must rule on:** the Studio UI has no
authenticated write path today (WS-Field-Research excludes authentication, and
CLAUDE.md notes a human-authorized UI write path is "a future, versioned
contract change"). WS-4's `workspace-override` endpoint has the identical
need. Proposal: define that mechanism once, shared with WS-4, rather than
per-workstream.

## Alternative considered (not recommended)

A §2b-mirror inbox artifact type (`field-research-<ts>-<suffix>.json`, pinned
`source: "field-research-inbox"`, plus a typed inbox dispatch in the WS-2
watcher). Rejected as the primary route because it carries *findings from a
local producer*, not *approvals*: the approval click still happens in the
hosted UI, so this route alone cannot satisfy the approval-by-write-path rule.
It becomes relevant only if research generation later moves to a local
producer and raw findings (pre-judgment) need to reach the Studio.

---

*WS-Field-Research · 2026-07-23 · updatedBy: claude (worker) — awaiting
Coordinator ruling.*
