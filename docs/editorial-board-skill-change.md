# Proposed Editorial Board skill change — end-of-review publication (S1–S6)

**Status: pending Codex review.**

**What this is.** The exact change to add to the UXistentialism Editorial Board
skill (hosted in Cowork, **outside this repository**). This session cannot reach
or edit the Cowork skill files, so this is a complete **proposed instruction
block** — paste it verbatim as the skill's final section. It changes nothing
else; it does not edit any other file in this repo. The safety-critical
mechanics live in the reviewed reference `docs/editorial-board-publisher.mjs`;
this block is the orchestration the skill performs around it.

**Conformance basis:** `docs/EDITORIAL_BOARD_OUTPUT.md`,
`docs/INGESTION_CONTRACT.md` §2b/§3/§5, and the live companion validator
`companion/validator.mjs` (`validateEditorialBoardData` / `validateInboxArtifact`).

---

## BEGIN skill section — "Publishing the review to the Studio"

> This step runs at the very end of a review, **after** the free-form review
> for Pegah is complete. The free-form review (full reasoning, may quote the
> manuscript) is for Pegah only and never leaves the session. This step emits a
> separate, bounded, public-safe **summary** artifact. It is additive: it must
> not alter or replace the free-form review.

### S1 — Build the artifact (data-only, exactly two top-level keys)

Construct this object. Emit **exactly** these fields — no more, no fewer (the
validator rejects unknown fields and missing fields):

```jsonc
{
  "sourceUpdatedAt": "<exact Date.toISOString() of this review>",
  "data": {
    "manuscript": {
      "id":          "<slug-style id matching the Studio concept; no spaces, no '/', no '.md'>",
      "title":       "<manuscript title>",
      "reviewRound": <integer>,                          // integer is a producer convention; validator enforces only a finite number
      "status":      "in review" | "awaiting ruling"   // NEVER "complete"
    },
    "reviewedAt":  "<exact Date.toISOString()>",
    "reviewers": [                                       // at least ONE entry
      {
        "role":           "<e.g. Evidence | Method | Structure | Voice>",
        "diagnosis":      "<diagnostic summary, ≤ 500 chars, no manuscript body>",
        "recommendation": "<advice, ≤ 500 chars>",
        "confidence":     "high" | "medium" | "low"
      }
    ],
    "unresolvedQuestions": ["<≤ 300 chars each>"],
    "rulings": [],                                       // ALWAYS empty
    "nextDecision": "<what awaits Pegah's judgment, ≤ 300 chars>",
    "sourceLabel":  "Claude Editorial Board · automated", // EXACT; middle dot is U+00B7
    "updatedAt":    "<exact Date.toISOString()>",
    "updatedBy":    "claude"                             // EXACT
  }
}
```

Hard rules the skill must satisfy (all enforced by the validator and the server —
violating any of them means the artifact is rejected, so satisfy them at
generation time):

- **Two top-level keys only:** `sourceUpdatedAt` and `data`. Any other key →
  rejected.
- **`rulings` is always `[]`.** Automated output never originates a human
  decision. A non-empty `rulings` is rejected regardless of `updatedBy`.
- **`updatedBy` is exactly `"claude"`; `sourceLabel` is exactly
  `"Claude Editorial Board · automated"`.** Never `"human"`, never a curated
  label — this is the automated path, and provenance is fixed, not asserted.
- **`manuscript.status` is `"in review"` or `"awaiting ruling"`** — never
  `"complete"` (human-attested state).
- **No `deferredThreads`** and no other field outside the schema above.
- **No manuscript body, transcript, filesystem path, `.md` filename, or
  credential** anywhere in `data` (the §5 public-safety scan rejects path-like
  strings; keep every string within its length cap).
- Timestamps are exact `Date.toISOString()` (`YYYY-MM-DDTHH:mm:ss.sssZ`) and must
  be real instants.
- **Producer conventions, not validator boundaries:** a slug-style
  `manuscript.id` (the validator requires only a string) and an integer
  `reviewRound` (the validator requires only a finite number). Emit both as
  conventions; do not rely on the validator to enforce them.

### S2–S3 — Stage + validate (fail-closed at the source)

Pipe the artifact to the reference publisher's `prepare` subcommand:

```
printf '%s' "$ARTIFACT_JSON" | \
  node /Users/pegahahmadi/Documents/uxistentialism-studio/docs/editorial-board-publisher.mjs prepare
```

`prepare` runs `validateInboxArtifact` (§2b), the length caps, and the
public-safety scan, then digests the staged bytes.

### S4 — Human checkpoint (fail-closed)

- **If `prepare` prints `BLOCKED …`** (validation failed, a length cap is false,
  or the public-safety scan reported any hit): it wrote **no** temp. The skill
  **does not offer Publish** — it reports the blocked reason to Pegah and STOPS.
  It must not attempt to "fix and force" the artifact past the gate.
- **If `prepare` prints the checkpoint report ending in `READY <token>`:**
  capture `<token>` (an opaque `32hex-64hex` string — **not** a path; the skill
  must never derive or guess a filesystem path from it). Show Pegah the
  checkpoint report (validation PASS, manuscript/counts/provenance metadata, and
  the bounded reviewer / question / nextDecision summaries), then say, in
  substance:

  > "This becomes **persistent live Iteration content** (stored in Redis until a
  > later review supersedes it). It contains no manuscript body, transcript,
  > paths, `.md` filenames, or credentials. Publish it to the Studio?"

  Wait for Pegah's **explicit** approval.
  - **Decline / no clear yes** → discard by token and STOP (the skill never
    `rm`s a path):
    ```
    node /Users/pegahahmadi/Documents/uxistentialism-studio/docs/editorial-board-publisher.mjs discard "$TOKEN"
    ```

### S5 — Publish (bound + any-failure-closed)

On explicit approval only:

```
node /Users/pegahahmadi/Documents/uxistentialism-studio/docs/editorial-board-publisher.mjs publish "$TOKEN"
```

`publish` resolves the token to a direct inbox child, recomputes the digest and
compares it to the approved one, re-runs schema + caps + public-safety, and only
then hard-links into place.

- `PUBLISHED <name>` → success. The final `editorial-board-<ts>-<uuid>.json` is a
  fully-written, atomically-created link the companion will pick up. A trailing
  `WARN cleanup-failed <code>` (rare) means the publish succeeded but the staging
  temp could not be removed — surface it; do not republish.
- **`FAILED <code>` (ANY failure — `digest-mismatch`, `revalidation-failed`, a
  `link-*` error, a rejected token, etc.)** → publication failed and nothing was
  written. The publisher **attempts** to remove the staged temp; a trailing
  `WARN cleanup-failed <code>` means the staged non-`.json` temp may remain. The
  skill STOPS and reports. **Never** retry with `mv`, `cp`, overwrite, or a direct
  POST, never broaden permissions or move the secret, and if a cleanup warning
  appears do not construct or `rm` a path manually — hand it to the Coordinator.

### S6 — Cleanup (always)

The publisher **attempts** to remove the staged temp on success and on every
applicable failure path, and surfaces any cleanup failure generically. If the
skill aborts between steps (e.g. on decline at S4), it cleans up **by token** via
`discard "$TOKEN"` — never by constructing or `rm`-ing a path. A cleanup warning
means the staged non-`.json` temp may remain and must be handled through the
Coordinator, never manually.

### What the skill must NEVER do

- Construct a transport envelope, or choose `schemaVersion` / `source` /
  `revision` / `payloadHash` — the companion (WS-2) owns all of that.
- Authenticate to the Studio or hold `STUDIO_SYNC_SECRET`.
- Assert human authorship (`updatedBy: "human"`, non-empty `rulings`, or
  `status: "complete"`).
- Publish without Pegah's explicit S4 approval.

## END skill section

---

## Notes for the skill author

- The publisher path above assumes the repo at
  `/Users/pegahahmadi/Documents/uxistentialism-studio`. If Cowork mounts the repo
  elsewhere, adjust the two `node …/editorial-board-publisher.mjs` paths only.
- If the Cowork session cannot run `node` or cannot hard-link on the inbox's
  filesystem, RQ1 is unmet: STOP and return to the Coordinator for a new delivery
  mechanism (Part B of `docs/PHASE_C_RUNBOOK.md` probes this first). Do not weaken
  the no-overwrite / no-partial-visibility requirement.
- `prepare`/`publish` are two separate invocations so the human checkpoint sits
  between them. The temp persists only across that approval window and is a
  non-`.json` file the companion's watcher ignores.
