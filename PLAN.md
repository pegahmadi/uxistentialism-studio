# WS-3 Approved Plan — PAUSED

Status: Plan APPROVED (Pegah, 2026-07-12); implementation PAUSED until WS-2's
inbox watcher is implemented and ready for the prototype dependency. Basis:
WORKSTREAM.md + its Coordinator Amendment + docs/INGESTION_CONTRACT.md v1.1.1.
Committed under the documented coordinator exception.

## Scope

Only repo deliverable: `docs/EDITORIAL_BOARD_OUTPUT.md` — the output contract
for the (externally hosted) Editorial Board skill. The skill emits a
DATA-ONLY artifact; the companion (WS-2) owns the entire transport envelope.
No code changes anywhere; no companion/ modifications (needs route through
the Coordinator as WS-2 amendments).

## Ratified specifics to fold into the output contract (v1.1.1)

1. **Artifact wire format** (contract §2b, ratified as WS-3 proposed):
   `{ "sourceUpdatedAt": "<exact Date.toISOString()>", "data": { …§2b… } }` —
   exactly two top-level keys; anything else → rejected/.
2. **Filename** (updated from the plan's open question): collision-resistant
   `editorial-board-<YYYY-MM-DDTHH-mm-ss-sssZ>-<unique-suffix>.json`
   (suffix = UUID or equivalent); created exclusively/atomically, never
   overwriting an existing path.
3. **Authority rules**: `rulings: []` always; `updatedBy: "claude"` always;
   `manuscript.status` restricted to `"in review" | "awaiting ruling"` —
   `"complete"` is human-attested and rejected server-side; `nextDecision` may
   name what awaits Pegah's judgment; no field implies an unmade decision.
4. **No direct-POST fallback**; companion offline → artifact waits in inbox.
5. **Content prohibitions**: no manuscript body, no transcript, no vault
   paths, no `.md` filenames, no credentials — note the server's redacted
   public-safety scan (§5) will also reject path-like strings anywhere.

## Research questions (formal gates, unchanged)

RQ1 inbox write access from a Cowork session (HARD GATE — on failure, return
to Coordinator; never broaden permissions or move the secret). RQ2
companion-offline accumulation (verify with WS-2). RQ3 how a board review
currently ends. RQ4 free-form review vs structured artifact delineation.

## Prototype plan (when unpaused)

1. Run a board review; document current final output (RQ3).
2. Add the structured data-only output step (shape above), write nowhere yet.
3. Write to ~/.studio-inbox/ per the filename convention (RQ1 gate).
4. On failure of 3 → STOP, return to Coordinator.
5. With WS-2 running: verify detection, validation, companion-authored
   envelope, POST, deletion on success; invalid artifact → rejected/.
6. Verify Iteration shows advice as advice; only fixture rulings render as
   human decisions.
7. Confirm no secret/body/transcript anywhere.

## Process

When unpaused: commit only docs/EDITORIAL_BOARD_OUTPUT.md to
ws/editorial-board-output. Never commit to main, never push, never merge.
WS-3 remains LAST in the merge order.
