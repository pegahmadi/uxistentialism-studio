# WORKSTREAM.md — Field Research MVP

Branch: `ws/field-research`
Worktree: `../studio-worktrees/field-research` (branched from `main` @ `892f628`)
Status: **scope frozen**. Build exactly what is listed here and stop.

---

## Objective

Give Field one honest research loop: Pegah triggers **one** research action, reads
a **sourced brief**, and **approves or dismisses each finding**. Approved findings
are routed through the **existing** companion boundary. Nothing else.

Field's governing question is *"What is happening in the world?"* — this must
sharpen that answer, not add a second product.

---

## Frozen scope (the whole of it)

1. **One `Research the field` action.** A single explicit trigger. No background
   polling, no scheduling, no auto-refresh.
2. **A sourced brief.** Each finding carries its source (title + URL/origin). A
   finding with no attributable source is not shown.
3. **Relevance and confidence** on each finding, displayed in the existing
   restrained mono language.
4. **Approve / dismiss per finding.** Per-finding, explicit, reversible only in
   the sense that dismissing is not destructive to the source data.
5. **Approved findings routed through the existing companion boundary.**
   Approved findings — and only approved ones — are staged for the companion.
   See *Boundary rules* below; this is the one place you must not improvise.
6. **Label sample data.** If no live research provider is available, ship clearly
   labelled sample data. The label must be visible in the UI, in the same honest
   provenance language the Studio already uses (`fixture` / `sample`, never
   silently presented as live). Never imply a live source you do not have.

---

## Hard exclusions

No additional architecture. No new contracts. No audits. No chatbot or assistant.
No publishing integrations. No polish passes. No new environments. No
authentication. No Redis manuscript/finding storage. No Obsidian write-back. No
changes to the Editorial Board, Iteration, or the ingestion contract.

If you believe the work needs any of the above, **stop and return to the
Coordinator** with the smallest possible proposed change. Do not invent another
workstream's interface.

---

## Boundary rules (read twice)

The companion boundary today is the watched inbox `~/.studio-inbox/`, drained by
the WS-2 companion, which owns the entire transport envelope and holds the sync
secret. Producers write **data-only artifacts**; they never authenticate, never
construct an envelope, and never assert human authorship.

- **Never** distribute or read `STUDIO_SYNC_SECRET`. No direct POST. No curl
  fallback.
- **Never** broaden filesystem permissions.
- **Never** write to the Obsidian vault.
- No manuscript bodies, transcripts, filesystem paths, `.md` filenames, or
  credentials in any payload or log.
- Approval is established by the **write path** (Pegah clicking approve), never
  asserted as a field in payload content.

**Known tension — resolve it by stopping, not by improvising.** There is today no
Field-Research ingestion endpoint or §2b-style schema. Routing approved findings
"through the existing companion boundary" therefore has a real chance of needing
a contract change — which this workstream **excludes**. So:

- If you can route approved findings using an existing, semantically correct
  mechanism, do so.
- If you cannot, **STOP.** Stage approved findings locally, mark the routing step
  clearly as unimplemented, and return to the Coordinator with the smallest
  proposed contract change. Do **not** reuse the editorial-board endpoint for
  field findings — that endpoint's provenance is pinned to the Editorial Board and
  would be a false claim.

---

## Existing code you will touch or read

- `app/(studio)/field/page.tsx` — server component; reads one projection snapshot
  (§8 snapshot rule) and renders `FieldView`, with a provenance label bottom-right.
- `components/studio/FieldView.tsx` — the current graph view.
- `lib/projection.ts` — `getProjection` / `getGraph` / `getGraphDetails`.
- `lib/data-result.ts` — the `DataSource` (`live` / `fallback` / `default`) shape
  used for honest provenance. **Reuse this language; do not invent a new one.**

Read `CLAUDE.md` and `docs/INGESTION_CONTRACT.md` before writing code. Treat the
ingestion contract as **read-only**.

---

## Conventions

- Preserve the existing visual language exactly: warm paper/ink, mono for marks
  and status, amber = needs judgment. No new colour or type roles.
- Provenance is never silent. Live, fixture, sample, and stale states all say so.
- Server components read data; client components own interaction.
- The repo lints with `eslint` (flat config, `eslint-config-next`) and typechecks
  with `tsc --noEmit`. Both must be clean, and `npm run build` must pass.
- `npm install` may need a temp cache: `npm install --cache "$(mktemp -d)"`.

---

## Acceptance test

1. Open Field. One `Research the field` action is visible; nothing runs on its own.
2. Trigger it once. A brief appears; every finding shows a source, a relevance,
   and a confidence.
3. If the data is sample data, the UI says so plainly.
4. Approve one finding and dismiss another. Both states are visible and persist
   across a refresh.
5. Approved findings — and only approved findings — reach the companion boundary,
   **or** the routing step is honestly marked unimplemented with a proposed
   contract change handed to the Coordinator.
6. `tsc`, `eslint`, and `npm run build` are clean; no console errors.

---

## Process

- Work only on `ws/field-research`. Never commit to `main`, never push, never
  merge, never deploy.
- Commit locally and present the diff for Codex review.
- Stop when the acceptance test passes. Do not continue into polish or adjacent
  features.
