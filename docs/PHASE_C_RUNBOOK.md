# Phase-C Cowork Test Runbook (WS-3 / UXI-18)

**Status:** prepared; **pending Codex review**. **NOT executed.**
Phase C runs in a real Cowork board session and is Pegah's to execute — the
coordinator cannot run it. This runbook proves the Editorial Board skill can
publish a structured artifact into `~/.studio-inbox/` end-to-end, through the
live companion, with a human checkpoint and fail-closed safety.

Governing docs (read first, in this order):
`docs/EDITORIAL_BOARD_OUTPUT.md` · `docs/editorial-board-publisher.mjs` ·
`docs/INGESTION_CONTRACT.md` §2b/§3/§5.

**Invariants that hold across every part.** Never broaden filesystem
permissions. Never expose, print, relocate, or copy `STUDIO_SYNC_SECRET`. Never
add a direct-POST/curl fallback. On any failure, the temp is deleted — review
data is never left in the inbox or in `/tmp`. The skill never constructs a
transport envelope, chooses `revision`/`payloadHash`, or asserts human
authorship (`updatedBy` is provenance, never authorization).

---

## Part A — one-time prerequisite: the skill change (external, Cowork)

The Editorial Board skill's end-of-review step is specified by
`docs/editorial-board-skill-change.md` and implemented by the reference
publisher `docs/editorial-board-publisher.mjs`. Pegah never hand-writes JSON or
runs publication commands — the skill drives S1–S6; Pegah's only action is the
S4 approval. Review the skill change (Codex) **before** Part B.

The skill's steps (summarized; full detail in the skill-change doc):

- **S1 Generate** the two-key artifact `{ sourceUpdatedAt, data }` from the
  completed review, per `docs/EDITORIAL_BOARD_OUTPUT.md`.
- **S2 Stage**: pipe the artifact to `editorial-board-publisher.mjs prepare`.
- **S3 Validate**: `prepare` runs the §2b validator + length caps +
  public-safety scan, then digests the staged bytes.
- **S4 Checkpoint (fail-closed).** **If validation fails, any length cap is
  false, or the public-safety scan reports any hits: `prepare` writes no temp,
  prints `BLOCKED <reason>`, does NOT offer Publish, and the skill STOPS and
  reports.** Only on a full pass does `prepare` write the exclusive mode-0600 temp
  and print the bounded checkpoint report ending in `READY <token>` — an **opaque
  token**, never a path. The skill shows the report to Pegah, states that it
  becomes persistent live Iteration content and contains no manuscript body /
  transcript / paths / `.md` / credentials, and waits for **explicit** approval.
  Decline → the skill runs `publish`'s sibling `discard <token>` and STOPS (it
  never `rm`s a path).
- **S5 Publish (bound + any-failure-closed).** On approval, `publish <token>`
  resolves the token to a direct inbox child, **recomputes the digest and
  compares it to the approved one**, **re-runs schema + caps + public-safety**,
  and only then hard-links to `editorial-board-<ts>-<uuid>.json` (atomic; no
  overwrite; no partial visibility). **Any digest mismatch, revalidation failure,
  or hard-link failure — not only `EEXIST` — publishes nothing. Never fall back
  to `mv`, `cp`, overwrite, or direct POST.**
- **S6 Cleanup (always).** Temp removed on success and on every failure path;
  cleanup failures are surfaced, never silently ignored. The final link persists
  until the companion submits + removes it.

---

## Part B — pre-flight mechanism check (harmless; NOT acceptance)

Confirms the skill's environment can hard-link and reach the inbox, touching no
production state. This is a feasibility gate, **not** WS-3 acceptance.

```
# B1. Harmless inbox-write probe — a NON-.json temp the companion ignores,
#     removed immediately. (The companion's filter only reacts to *.json.)
P=~/.studio-inbox/.studio-write-probe-$(uuidgen); : > "$P" && rm -f "$P" && echo "inbox writable ✓"

# B2. Hard-link primitive in a scratch dir (same primitive Part A uses):
D=$(mktemp -d); printf '{}' > "$D/a.tmp"
ln "$D/a.tmp" "$D/final.json" && echo "atomic-create ✓"
echo x > "$D/exists.json"; ln "$D/a.tmp" "$D/exists.json" 2>/dev/null && echo "OVERWROTE (FAIL)" || echo "no-overwrite ✓"
rm -rf "$D"
```

If B1 or B2 cannot be performed by the skill's tools → **STOP**, return to the
Coordinator (RQ1 unmet). Do not weaken the requirement.

---

## Part C — acceptance run (real review; result persists live)

1. Pegah completes a **real** Editorial Board review of a real manuscript, ready
   for its result to become live Iteration state.
2. The skill runs S1–S6. Pegah's only action is the S4 approval.
3. Coordinator-side verification (Pegah, on the Mac):

```
# inbox drained (clean form; no error when empty):
find ~/.studio-inbox -maxdepth 1 -type f -name '*.json'      # expect no output

# server accepted + persists:
curl -s https://uxistentialism-studio.vercel.app/api/sync-status
#   → keys["editorial-board"].revision non-null, lastSuccessfulSync recent
```

`/iteration` reflects the review as **advice**; rulings render as human decisions
only from the curated fixture, never from this artifact. The stored board state
persists in Redis until a later review supersedes it.

---

## Part D — privacy (guarded; never prints VAULT or LOG paths)

```
LOG="$HOME/Library/Logs/studio-companion.log"

if ! VAULT=$(node --input-type=module -e 'import("/Users/pegahahmadi/Documents/uxistentialism-studio/companion/config.mjs").then(m=>m.loadConfig({configPath:process.env.HOME+"/.config/uxistentialism-studio/config.json"})).then(c=>process.stdout.write(c.vaultPath)).catch(()=>process.exit(1))'); then
  echo "STOP: companion configuration could not be loaded."
  return 1 2>/dev/null || exit 1
fi

if [ -z "$VAULT" ]; then
  echo "STOP: configured vault path is empty."
  return 1 2>/dev/null || exit 1
fi

if [ ! -f "$LOG" ]; then
  echo "STOP: companion log is unavailable."
  return 1 2>/dev/null || exit 1
fi

echo "vault-path leaks:    $(grep -cF "$VAULT" "$LOG")"
echo "absolute-path leaks: $(grep -cE '/Users/' "$LOG")"
echo "note-filename leaks: $(grep -cE '\.md\b' "$LOG")"
echo "bearer markers:      $(grep -cE 'Bearer' "$LOG")"

unset VAULT LOG
```

**All four counts must equal zero.** `$VAULT` and `$LOG` are used only as grep
inputs, never printed; they are unset immediately after. Any non-zero count →
STOP and return to the Coordinator. The secret is redacted by the logger by
construction; also confirm it never appears in the board session's own output.

---

## STOP conditions → halt, return to Coordinator, report

- Part B: no hard-link, or no inbox write, in the skill's environment.
- S3/S4 validation FAIL, caps false, or any public-safety hit → temp deleted, no
  publish.
- S4 declined → temp deleted, no publish.
- S5 ANY hard-link failure → temp deleted, no publish; never mv/cp/overwrite/POST.
- Any Part-D count non-zero, or a Part-D precondition STOP.

Never broaden permissions, expose/relocate the secret, or add a fallback. On any
failure the temp is deleted (no data left in inbox or `/tmp`).

---

## On full pass

WS-3 is proven end-to-end through the real skill with a real, persisted review.
Report the evidence for Codex to close UXI-18 / mark WS-3 done. Until then,
UXI-18 stays In Progress and WS-3 is not complete.
