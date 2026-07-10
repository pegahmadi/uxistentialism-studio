# Vault Audit Plan

Obsidian is the **thinking archive** (source of truth). UXistentialism Studio is
a **lens** over it. This document records the agreed plan for auditing the vault
before the Studio depends on it. It is not an app feature.

## The hard boundary

```
Obsidian vault  ──read-only──►  Audit tool  ── derives ──►  manifest + report
   (archive)     never writes     (this repo)   (flat files, gitignored)
```

- Obsidian stays the source of truth. The Studio never becomes a second home for
  the material, and we do not recreate Obsidian (no editor, folder browser, or
  graph-view clone).
- The audit produces a **derived manifest + a cleanup/ontology worklist** — flat
  files, **not a database**, **not app data**.
- The app is untouched during the audit. We stop at "we understand the vault and
  have a mapping" before any wiring.

## Safety model

1. **Read-only, structurally.** No code path writes/renames/deletes in the vault.
   Files are opened read-only; the only writes are to the repo's gitignored
   `.vault-audit/` output directory.
2. **Reads the live vault each run** (per decision — no snapshot copy to go
   stale while cleanup happens in Obsidian).
3. **Refuses unsafe targets.** The tool aborts if the vault path resolves inside
   this repo.
4. **Nothing from the vault is committed.** Vault path config and all outputs are
   gitignored. Publishing anything derived from the vault is a separate, explicit
   choice.
5. **No network, no AI, no side effects** in v1. Deterministic and local.
6. **Human-in-the-loop.** The tool only *proposes*. Cleanup happens in Obsidian,
   by hand. The Studio never mutates the archive.

## Guiding principle: strengthen the ontology, not just the files

The audit's real goal is to improve the **architecture of the knowledge system**,
not to tidy notes. Where the material reveals that a concept should be **split,
renamed, elevated, or merged**, the audit should surface that as a structural
recommendation. M1 deliberately collects the relational inputs that make this
possible: the link graph, unresolved (referenced-but-missing) links, alias and
duplicate collisions, tag frequency, and backlink hubs.

## Metadata extracted (mixed vault — lean on structure over frontmatter)

Declared frontmatter is inconsistent, so we lean on **structure, links,
headings, and filenames**, using frontmatter when present:
- **Declared:** title/aliases, tags, dates, `status`/`type` if present.
- **Derived:** H1/title, summary, heading outline, word count, outbound
  `[[wikilinks]]`, `#tags`, external URLs, TODO/WIP/question markers.
- **Relational:** containing folder, inbound backlink count, orphan status,
  near-duplicate titles/aliases, **unresolved link targets**, and file mtime as a
  staleness proxy.

## Classification (M2 — proposed, never auto-applied)

`current` · `needs updating` · `merge candidate` · `archive candidate` ·
`expand candidate` — each with the signals that triggered it, for review.

## Vault → Studio concept mapping (M3 — by nature of the note, not by folder)

Idea (primary) · Concept · Signal · Observation · Question (first-class) ·
Source · Lineage (derived) · Memory. Wikilinks become first-class **Connections**.
A note may map to more than one concept. Folders are hints, not structure to
reproduce.

## How the six modes read the material (M4 — queries, not folders)

Each mode is a query with a relationship to time over the mapped pool; a single
Idea can appear in several modes at once. Today (present) · Field (ongoing world)
· Formation (the not-yet) · Iteration (near past, reopened) · Distribution
(release) · Memory (accumulated past).

## Sequence

- **M1 — Scanner (this milestone):** read-only metadata manifest + report. Prove
  read-only; reconcile counts.
- **M2 — Classification:** heuristic worklist → you clean up in Obsidian.
- **M3 — Concept mapping + ontology recommendations:** propose concept tags,
  Connections, and split/rename/elevate/merge suggestions.
- **M4 — Mode-view spec:** define how each mode queries the mapped material.
- **Later (separate milestone):** a curated projection the app reads (still flat
  files, not a DB), then wire modes to real content.

## Not building yet

No database · no app wiring · no write-back to Obsidian · no sync/watcher · no
Medium/Substack · no Obsidian clone · no auto-cleanup · no AI classification.
