# Proposed Editorial Board skill change — end-of-review publication (S1–S6)

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
      "reviewRound": <integer>,
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

### S2–S3 — Stage + validate (fail-closed at the source)

Pipe the artifact to the reference publisher's `prepare` subcommand:

```
printf '%s' "$ARTIFACT_JSON" | \
  node /Users/pegahahmadi/Documents/uxistentialism-studio/docs/editorial-board-publisher.mjs prepare
```

`prepare` runs `validateInboxArtifact` (§2b), the length caps, and the
public-safety scan.

### S4 — Human checkpoint (fail-closed)

- **If `prepare` prints `BLOCKED …`** (validation failed, a length cap is false,
  or the public-safety scan reported any hit): it wrote **no** temp. The skill
  **does not offer Publish** — it reports the blocked reason to Pegah and STOPS.
  It must not attempt to "fix and force" the artifact past the gate.
- **If `prepare` prints the checkpoint report ending in `READY <tempPath>`:**
  capture `<tempPath>`. Show Pegah the checkpoint report (validation PASS,
  manuscript/counts/provenance metadata, and the bounded reviewer / question /
  nextDecision summaries), then say, in substance:

  > "This becomes **persistent live Iteration content** (stored in Redis until a
  > later review supersedes it). It contains no manuscript body, transcript,
  > paths, `.md` filenames, or credentials. Publish it to the Studio?"

  Wait for Pegah's **explicit** approval.
  - **Decline / no clear yes** → delete the temp and STOP:
    `rm -f "$TEMP"` (the temp is a `.eb-publish-*.tmp` in `~/.studio-inbox/`).

### S5 — Publish (any-failure-closed)

On explicit approval only:

```
node /Users/pegahahmadi/Documents/uxistentialism-studio/docs/editorial-board-publisher.mjs publish "$TEMP"
```

- `PUBLISHED <name>` → success. The final `editorial-board-<ts>-<uuid>.json` is a
  fully-written, atomically-created link the companion will pick up.
- **`FAILED <code>` (ANY failure, not only `link-EEXIST`)** → publication failed.
  The publisher has already deleted the temp. The skill STOPS and reports.
  **Never** retry with `mv`, `cp`, overwrite, or a direct POST, and never
  broaden permissions or move the secret.

### S6 — Cleanup (always)

The publisher removes the temp on success and on every failure path. The skill
additionally guarantees no `.eb-publish-*.tmp` it created is left behind if it
aborts between steps (e.g. on decline at S4): `rm -f "$TEMP"`. Review data is
never left in the inbox or in `/tmp`.

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
