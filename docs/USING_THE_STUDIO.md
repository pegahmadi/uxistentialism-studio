# Using the Studio

A short, manual workflow for developing **one real article** in the Studio. This
is intentionally hand-run — there is no automation yet, and none should be added
until real use reveals a genuine need.

## The loop

### 1. Set your Workspace

Edit [`data/studio/workspace.json`](../data/studio/workspace.json) — your active
thinking context. Set:

- `activeManuscript` — the piece in motion (`id`, `title`, `round`, `venue`)
- `approvedFormationTopic` — the emerging idea you have deliberately promoted
- `openQuestions` — the question(s) you are holding
- `status` — `active` | `paused` | `resting`
- `todayNote` — optional short note to surface in Today

Every field is optional except `schemaVersion`; the app degrades gracefully.
Keep it public-safe: pointers and short notes only — no absolute paths, no
manuscript bodies, no secrets. See
[`workspace.example.json`](../data/studio/workspace.example.json).

### 2. Curate the Editorial Board projection

After a completed Claude Editorial Board review, hand-write
[`data/projections/editorial-board.json`](../data/projections/editorial-board.json)
using **short, public-safe diagnostic summaries only** — never the manuscript
body, never a private transcript, never keys. A ruling is a decision record
(`{ on, decision }`). See
[`editorial-board.example.json`](../data/projections/editorial-board.example.json).

### 3. Refresh from Obsidian

```
npm run refresh-studio
```

This regenerates the read-only Obsidian projection, verifies the vault was not
touched, checks the projection is public-safe, runs lint and build, summarizes
what changed, and **stops before any git action**. Review the diff, then commit
yourself.

### 4. Open Today

- Confirm it points to the right active work.
- When judgment is pending, follow the route it gives you to Iteration.

### 5. Use Iteration to review

- the board's most consequential unresolved question
- reviewer disagreement or convergence
- existing rulings
- the next human decision

### 6. Record friction, don't build

When something is missing or awkward, write it down as a **product observation**
— not an immediate feature. Real use, accumulated over a real article, is what
should justify the next thing we build.

## Operating principles

- **Today routes attention.** It names where attention belongs and points onward.
- **Iteration holds judgment.** The specific decision lives here, not in Today.
- **The Board advises; the human decides.** Rulings are yours; recommendations are input.
- **Obsidian remains the source of truth.** The Studio never writes back to it.
- **Projections remain read-only and public-safe.** The app reads only committed
  projections, never a live source.
- **No new connector** should be added unless real use reveals a need.
