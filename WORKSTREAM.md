# WORKSTREAM.md — WS-3: Editorial Board Structured Output

Branch: `ws/editorial-board-output`
Worktree: `../studio-worktrees/editorial-board-output`
Status: research and prototype first; production integration only after mechanism is verified

---

## Objective

Define how the UXistentialism Editorial Board v2.1 emits a structured JSON
artifact automatically at the end of a review session, and how that artifact
reaches the Studio's ingestion layer without Pegah copying text, editing JSON,
or running a command. After WS-3, completing a board review and seeing the Studio
Iteration view update are one action, not two.

---

## Shared contracts implemented

- `CLAUDE.md` — read before writing any code
- `docs/INGESTION_CONTRACT.md` §2b — the Editorial Board data schema the
  structured artifact must match exactly
- `docs/INGESTION_CONTRACT.md` §3 — authentication contract (inbox mechanism
  keeps the sync secret inside the companion only)

---

## Allowed files

This workstream creates or modifies only:

```
docs/EDITORIAL_BOARD_OUTPUT.md     (new — output contract for the skill)
```

The Editorial Board skill itself lives outside this repository (in Cowork skills).
Changes to it are coordinated here but made there. Do not modify any `app/`,
`lib/`, or `companion/` files. The companion's inbox-watcher (WS-2) is the
ingestion mechanism; this workstream defines only the output format and the drop
mechanism.

---

## Forbidden files

Do not modify:
- `companion/` — owned by WS-2; the inbox watcher is already defined there
- `lib/`, `app/`, `data/` — owned by WS-1
- `CLAUDE.md`, `docs/INGESTION_CONTRACT.md` — read only
- Obsidian vault — never touched

---

## The delivery mechanism

Editorial Board output enters the Studio through the private watched inbox folder
(`~/.studio-inbox/`), not through direct API calls. This keeps `STUDIO_SYNC_SECRET`
inside the companion configuration only — it does not need to be distributed to
every Claude or Cowork session that might run a board review.

The chosen mechanism for the first implementation:

At the end of a board review session, the Editorial Board skill writes a structured
JSON file to `~/.studio-inbox/editorial-board-[ISO-timestamp].json` using the
Write tool available in Cowork. The companion's inbox watcher (WS-2) detects the
file, validates it, POSTs it to `/api/ingest/editorial-board`, and deletes it on
success. The Studio Iteration view shows updated board state on next navigation.

Direct curl POST (from a bash tool call in the skill) remains a fallback option
for cases where the companion is not running, but it requires the sync secret to
be available in the shell environment and is therefore not the primary mechanism.

---

## Research questions to resolve

Before production integration, verify:

1. **Does the Cowork Write tool have access to `~/.studio-inbox/`?**
   The skill must be able to write to this path. Verify in a test session before
   committing to the mechanism.

2. **Does the companion's inbox watcher run reliably when a board review is in
   progress?**
   If the companion is paused or offline, the inbox file accumulates. Verify that
   accumulated files are submitted correctly when the companion restarts.

3. **How does the board review currently end?**
   Understand the final state the skill produces before adding a structured
   output step. The additional step must not disrupt the primary review flow.

4. **What is the right delineation between the free-form review (for Pegah to
   read) and the structured artifact (for the Studio)?**
   The structured artifact is a projection summary; it must not contain the
   manuscript body or the full review transcript.

---

## Output contract for the Editorial Board skill

Document this contract in `docs/EDITORIAL_BOARD_OUTPUT.md`.

The skill's final step produces a JSON file matching exactly the Editorial Board
payload defined in `docs/INGESTION_CONTRACT.md` §2b, wrapped in the standard
envelope from §1:

```json
{
  "schemaVersion": 1,
  "source": "editorial-board-inbox",
  "sourceUpdatedAt": "<ISO timestamp of the session>",
  "projectedAt":    "<ISO timestamp when the skill writes the file>",
  "revision":       1,
  "payloadHash":    "sha256-...",
  "data": {
    "manuscript": {
      "id":          "<manuscript slug>",
      "title":       "<manuscript title>",
      "reviewRound": <integer>,
      "status":      "in review"
    },
    "reviewedAt":   "<ISO timestamp>",
    "reviewers": [
      {
        "role":           "<reviewer role>",
        "diagnosis":      "<max 500 chars — diagnostic summary only>",
        "recommendation": "<max 500 chars>",
        "confidence":     "high" | "medium" | "low"
      }
    ],
    "unresolvedQuestions": ["<max 300 chars each>"],
    "rulings": [
      { "on": "<max 300 chars>", "decision": "<max 500 chars>" }
    ],
    "nextDecision":  "<max 300 chars>",
    "sourceLabel":   "Claude Editorial Board · automated",
    "updatedAt":     "<ISO timestamp>",
    "updatedBy":     "claude"
  }
}
```

Content rules (strictly enforced by companion inbox validator):
- `diagnosis` and `recommendation` are short diagnostic summaries. No manuscript
  body text. No private transcript excerpts.
- `unresolvedQuestions` and `rulings` contain only short strings. No long form text.
- No vault paths, no note bodies, no credentials anywhere in the payload.

The `revision` field in the inbox file starts at 1 for each new review round.
The companion may increment it if it needs to resubmit.

---

## Prototype plan

1. Run a board review session normally and observe the final output structure.
2. Add a structured output step to the skill that produces the JSON in the
   correct schema (without submitting it anywhere yet).
3. Have the skill write the file to `~/.studio-inbox/` (verify Write tool access).
4. With WS-2 companion running, confirm the file is picked up, validated, and
   submitted.
5. Verify that Studio Iteration view reflects the new board state.
6. Verify the inbox file is deleted after successful submission.
7. If step 3 fails (Write tool cannot reach the path), evaluate the fallback
   mechanism (direct POST with secret from companion config, not general env).

---

## Acceptance criteria

1. Completing a board review session produces a structured JSON file in
   `~/.studio-inbox/` with no action from Pegah beyond running the review.
2. The companion picks up the file within a few seconds and submits it.
3. The Studio Iteration view shows the updated board state on next navigation.
4. The inbox file is deleted after successful submission.
5. A rejected file (invalid schema) moves to `~/.studio-inbox/rejected/` with
   the original filename and a visible log error.
6. The sync secret does not appear anywhere in the board review session output,
   logs, or the inbox file itself.
7. The full review transcript does not appear in the submitted payload.

---

## Security requirements

- The sync secret must not be distributed to board review sessions.
- The inbox mechanism keeps credentials inside the companion only.
- Manuscript body text must not appear in the structured output.
- Only the Editorial Board skill (via Write tool) and the companion (reading for
  submission) should access `~/.studio-inbox/`. The directory should be mode 700.

---

## Test plan

1. Prototype: manually write a valid inbox JSON file and verify companion picks
   it up and submits it.
2. Prototype: manually write an invalid inbox file and verify it moves to rejected/.
3. Integration: run a board review, verify the file appears, verify submission.
4. Regression: verify that the board review primary output (free-form text for
   Pegah) is unchanged by the additional structured output step.

---

## Handoff requirements

Before marking WS-3 complete:
- `docs/EDITORIAL_BOARD_OUTPUT.md` written with the complete output contract
- All research questions resolved with documented answers
- Prototype verified end-to-end with a real board review
- All acceptance criteria pass
- No secrets, no manuscript bodies in any submitted payload (confirmed in Upstash
  console or via sync-status endpoint)

---

## Known dependencies

- **WS-2 companion inbox watcher must be running** for this workstream to complete
  its end-to-end acceptance test. WS-2 must be complete before the full test.
- **WS-1 must be deployed** for the Studio to reflect updated board state.
- This workstream does not modify any code in this repository; it produces
  documentation and a skill update (external). If the prototype reveals that the
  companion needs a behavioral change, that change is a WS-2 amendment, not a
  WS-3 change.
