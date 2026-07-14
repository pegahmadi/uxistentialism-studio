# Editorial Board Output Contract (WS-3)

**Status:** Phase B — output contract documented against ingestion contract
**v1.1.3** (UXI-18, 2026-07-14). A reference publisher
(`docs/editorial-board-publisher.mjs`) now specifies the skill's end-of-review
step in reviewable, path-tested code — but the end-to-end delivery mechanism
(RQ1) is still **not empirically verified in a real Cowork session** — see
[Reference publisher](#reference-publisher-the-skills-end-of-review-step),
[Delivery mechanism](#delivery-mechanism), and
[Research questions](#research-questions). Nothing here asserts that the Cowork
workflow has been tested.

This document specifies the artifact the UXistentialism Editorial Board skill
(hosted externally, in Cowork — not in this repository) writes at the end of a
review, and the boundaries that make it safe. It is the producer-side companion
to `docs/INGESTION_CONTRACT.md` §2b. Where anything here appears to diverge from
`docs/INGESTION_CONTRACT.md`, **the ingestion contract governs.**

---

## Model

The Board **advises**; Pegah **decides**. The skill emits a **data-only**
artifact into a watched inbox. It never authenticates to the Studio, never
constructs a transport envelope, and never asserts human authorship:

```
Editorial Board skill (Cowork)          Local companion (WS-2)         Studio (WS-1)
─────────────────────────────           ──────────────────────         ─────────────
writes { sourceUpdatedAt, data }  ──►    detects, validates §2b,   ──►  re-validates,
to ~/.studio-inbox/ (exclusive)          builds the full envelope        atomic CAS,
                                         (revision, payloadHash,         stores in Redis
                                          source), POSTs it
```

The skill owns **only** the file it writes. The companion owns the entire
transport envelope (`schemaVersion`, `source`, `projectedAt`, `revision`,
`payloadHash`) and assigns `revision` from its persistent `editorial-board`
sequence. The skill must never choose any of those.

---

## Artifact wire format

A file with **exactly two top-level keys** — nothing else:

```json
{
  "sourceUpdatedAt": "2026-07-12T18:04:07.123Z",
  "data": { }
}
```

- `sourceUpdatedAt` — the review's own event time, in the **exact
  `Date.toISOString()` format** `YYYY-MM-DDTHH:mm:ss.sssZ`. It must also
  round-trip (`new Date(Date.parse(t)).toISOString() === t`), so impossible
  calendar dates (e.g. `2026-02-31T…`) are invalid. The companion uses this as
  the envelope's `sourceUpdatedAt`; it never substitutes the file's mtime.
- `data` — the schema below, **exactly**.
- **Any other top-level key → the companion moves the file to `rejected/`.**
- A missing or malformed `sourceUpdatedAt` → `rejected/`.

---

## `data` schema (must match §2b exactly)

```typescript
{
  manuscript: {
    id:          string;   // §2b requires only a string (see id convention note below)
    title:       string;
    reviewRound: number;
    status:      "in review" | "awaiting ruling";   // see Authority rules — NOT "complete"
  };
  reviewedAt:   string;            // ISO 8601, exact toISOString() + round-trip
  reviewers: Array<{               // at least ONE entry
    role:           string;
    diagnosis:      string;        // ≤ 500 chars — diagnostic summary only
    recommendation: string;        // ≤ 500 chars — advice only
    confidence:     "high" | "medium" | "low";
  }>;
  unresolvedQuestions: string[];   // each ≤ 300 chars
  rulings: [];                     // ALWAYS empty (see Authority rules)
  nextDecision:  string;           // ≤ 300 chars
  sourceLabel:   "Claude Editorial Board · automated";   // EXACT string (see below)
  updatedAt:     string;           // ISO 8601, exact toISOString() + round-trip
  updatedBy:     "claude";         // EXACT (see below)
}
```

- **Unknown fields inside `data` are rejected with 400.** In particular, do
  **not** emit `deferredThreads` — it is not part of the §2b submitted schema
  (the committed fixture reader tolerates it for legacy data; submissions may
  not include it).
- `reviewers` must contain at least one entry.
- The middle dot in `sourceLabel` is **U+00B7** (`·`), not a hyphen.

**`manuscript.id` convention (producer-side, NOT enforced here).** Contract §2b
and the companion/server board validator require only that `id` is a `string` —
empty, whitespace, and relative-slash values currently pass ingestion (unlike
the *Obsidian* endpoint, which does enforce a slug rule on concept ids). As a
**producer convention**, the Editorial Board skill SHOULD emit a slug-style id
(non-empty, no whitespace, no `/`) matching the manuscript's Studio concept id,
so the Studio can correlate the review with the right piece — but this is a
recommendation, not a validation boundary. (Note: a `.md` fragment anywhere in
`data`, including in an id, is separately rejected by the §5 public-safety scan
as a path-like string.)

---

## Authority rules (the boundary this contract exists to protect)

`updatedBy`, `sourceLabel`, and `manuscript.status` are **provenance metadata,
not authorization**. The sync secret authenticates the companion, not the
authorship of any field, so the ingestion endpoint fixes automated provenance
rather than trusting it. Enforced at **all three layers** — this skill, the
WS-2 companion validator, and the WS-1 server:

1. **`rulings` is always `[]`.** A ruling is a human decision record; automated
   output never originates one. A non-empty `rulings` array is rejected (400)
   regardless of `updatedBy`. `nextDecision` may name what awaits Pegah's
   judgment; reviewer `recommendation`s stay advice; **no field may imply a
   decision Pegah did not explicitly make.**
2. **`updatedBy` must be exactly `"claude"`.** Asserting `"human"` through this
   automated path is the exact false attestation the rulings rule forbids → 400.
3. **`sourceLabel` must be exactly `"Claude Editorial Board · automated"`.**
   Display metadata must not be usable as evidence of human authorship → 400.
4. **`manuscript.status` must be `"in review"` or `"awaiting ruling"`.**
   `"complete"` is human-attested state and is rejected on every live
   submission → 400. `"awaiting ruling"` names unresolved judgment; it claims
   no decision.

Live human rulings and live `"complete"` state await a future, genuinely
human-authorized write path (an authenticated Studio UI action with explicit
confirmation) — a versioned contract change, out of WS-3 scope.

---

## Filename and creation semantics

Write to `~/.studio-inbox/` with this name:

```
editorial-board-<timestamp>-<unique-suffix>.json
```

- `<timestamp>` — `Date.toISOString()` with `:` and `.` replaced by `-`
  (e.g. `2026-07-12T18-04-07-123Z`).
- `<unique-suffix>` — a UUID or equivalently unique identifier. A millisecond
  timestamp alone can collide; the suffix guarantees uniqueness.

**Publication semantics — two properties, both required, both a Phase-C gate.**
Before this delivery mechanism is trusted, Phase C must **empirically
demonstrate** that the Cowork Write tool can publish the artifact such that:

1. **No overwrite** — creating the artifact never replaces an existing
   destination path.
2. **No partial visibility** — the companion's watcher only ever observes a
   *fully written* artifact, never a partially-written file at its final path.

An exclusive-create flag alone is **not sufficient**: it satisfies (1) but can
still expose a partially-written final file to the watcher, failing (2). The
concrete mechanism (for example, writing to a temporary path and atomically
renaming into place) is **not prescribed here** — Phase C determines what the
Cowork environment can actually guarantee. If neither property can be met with
the tools available to the board session, **stop and return to the
Coordinator** (see [Delivery mechanism](#delivery-mechanism)); do not weaken the
requirement. (The companion's size-stability guard is defense-in-depth against
partials, not a substitute for atomic publication.)

The companion processes artifacts oldest-first by the parsed timestamp prefix,
with the unique suffix as a deterministic tie-break (file mtime is the fallback
for nonconforming names).

---

## Reference publisher (the skill's end-of-review step)

`docs/editorial-board-publisher.mjs` is the reviewable, path-tested reference for
the skill's final step. It performs **only** the safety-critical, deterministic
parts; the skill orchestrates around it and inserts the human checkpoint. Two
subcommands, with Pegah's explicit approval between them:

- **`prepare`** — reads the two-key artifact on stdin, runs `validateInboxArtifact`
  (§2b), checks length caps, and runs the public-safety scan. **If validation
  fails, any length cap is exceeded, or the scan reports any hit → it prints
  `BLOCKED <reason>`, writes no temp, and exits non-zero.** Publish is never
  offered for a failing artifact, and nothing is left behind. On a full pass it
  writes a non-`.json` temp the companion ignores (`.eb-publish-<uuid>.tmp`, in
  the inbox so the later hard link stays on one filesystem), prints the bounded
  checkpoint report (metadata + the exact reviewer/question/nextDecision
  summaries that will become live Iteration content — there is no manuscript body
  in the artifact), and prints `READY <tempPath>`.
- **`publish <tempPath>`** — hard-links the approved temp to the final
  `editorial-board-<ts>-<uuid>.json`. A hard link is atomic, never overwrites,
  and never exposes a partial file. **Any link failure — not only `EEXIST` —
  deletes the temp, prints `FAILED <code>`, and exits non-zero; it never retries
  with `mv`, `cp`, overwrite, or a direct POST.** On success it deletes the temp
  (the final link persists until the companion submits it) and prints
  `PUBLISHED <name>`.

On any failure at any step the temp is removed: review data is never left in the
inbox or in `/tmp`. The publisher never constructs a transport envelope, chooses
`revision`/`payloadHash`, authenticates to the Studio, holds the sync secret, or
asserts human authorship — those remain the companion's and the human write
path's alone.

**This reference does not itself resolve RQ1.** It is the mechanism to be
validated in a real Cowork board session (Phase C), and only if that session can
actually run it (hard links available on the inbox's filesystem). If the Cowork
environment cannot execute this publish primitive with the no-overwrite and
no-partial-visibility guarantees above, the skill must **stop and return to the
Coordinator** — never broaden permissions, expose or relocate the sync secret, or
invent a fallback.

---

## Content prohibitions

The artifact is a short, public-safe **projection summary** — never source
material. It must never contain:

- manuscript body text or any excerpt of it;
- private review-transcript text;
- filesystem paths or `.md` filenames (the server also runs a redacted §5
  public-safety scan that rejects path-like strings anywhere in `data`);
- credentials, tokens, or the sync secret in any form.

Keep every string within its length cap; caps exist so summaries stay summaries.

---

## Delivery mechanism

Delivery is **exclusively** the watched inbox `~/.studio-inbox/`, written by the
[reference publisher](#reference-publisher-the-skills-end-of-review-step). There
is **no direct-POST fallback**: the sync secret is never distributed to a
board-review session. If the companion is offline when the artifact is written, the file
simply waits in the inbox and is drained when the companion next runs (startup
drain + the periodic reconciliation, per WS-2). The mode-700 inbox and its
`rejected/` subdirectory are created and verified by the companion.

**Not yet verified (RQ1):** whether the Cowork Editorial Board session's Write
tool can create a file in `~/.studio-inbox/` with the exclusive/atomic,
non-overwriting semantics above. This is a hard gate resolved only in a real
Cowork board session (Phase C). If those semantics cannot be met, the skill
must **stop and return to the Coordinator** for a new delivery mechanism — it
must never broaden filesystem permissions, expose or relocate the sync secret,
or invent a fallback.

---

## Research questions

RQ1 is a hard, unresolved gate (above). RQ2–RQ4 are answered here **only** to
the extent they can be reasoned without a live board session; each is labeled
**provisional** until empirically verified in Phase C.

- **RQ1 — inbox write access + semantics.** UNRESOLVED. Requires a real Cowork
  session to confirm the Write tool can create the file exclusively/atomically
  without overwriting. Consumer side is ready (companion live in production).
- **RQ2 — companion-offline accumulation.** PROVISIONAL. By design, artifacts
  written while the companion is offline remain in the inbox and are drained on
  its next startup/reconcile (WS-2). To be verified end-to-end against the live
  companion in Phase C.
- **RQ3 — how a board review currently ends.** PROVISIONAL. Assumed to end with
  free-form prose for Pegah, with no structured emission today; the structured
  write is an additive final step. To be confirmed by observing a real review
  before wiring the step in.
- **RQ4 — free-form review vs structured artifact.** PROVISIONAL. The free-form
  review (full reasoning, may quote the manuscript) is for Pegah only and never
  leaves the session; the structured artifact is the bounded summary defined
  here. To be confirmed by inspecting a produced artifact against a real review
  in Phase C.

---

## Example artifact (illustrative)

```json
{
  "sourceUpdatedAt": "2026-07-14T15:22:08.004Z",
  "data": {
    "manuscript": { "id": "authority-architecture", "title": "Authority Architecture", "reviewRound": 4, "status": "awaiting ruling" },
    "reviewedAt": "2026-07-14T15:22:08.004Z",
    "reviewers": [
      { "role": "Evidence", "diagnosis": "§3's mechanism claim rests on assertion, not a documented case.", "recommendation": "Ground §3 in one real case before it travels.", "confidence": "high" },
      { "role": "Method", "diagnosis": "The mechanism is theorized ahead of observation.", "recommendation": "Observe first; let the evidence follow.", "confidence": "medium" }
    ],
    "unresolvedQuestions": ["Does §3's mechanism need a documented case, or observation first?"],
    "rulings": [],
    "nextDecision": "Rule on §3: require a documented case, or reframe the section as observation-first.",
    "sourceLabel": "Claude Editorial Board · automated",
    "updatedAt": "2026-07-14T15:22:08.004Z",
    "updatedBy": "claude"
  }
}
```

Note the empty `rulings`, the exact `sourceLabel`, `updatedBy: "claude"`,
`status: "awaiting ruling"`, and the absence of `deferredThreads`.
