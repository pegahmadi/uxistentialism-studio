# Contributing

UXistentialism Studio is early-stage. At this point contributing means helping
shape its direction with the same care the product asks of its users. This
guide keeps that work coherent.

## Principles to Uphold

Every contribution should be measured against the product's core belief: the
Studio exists to help ideas **mature**, not to help people produce faster. In
practice:

- **The Idea is the object.** Build around ideas as they mature, not around
  documents, files, or notes. Documents are outputs of an idea.
- **Connections are first-class.** Relationships between ideas, observations,
  sources, and discussions are primary data, not a visualization bolted on
  later.
- **Preserve continuity.** History and lineage are append-only. Never design a
  change that overwrites or discards how an idea developed.
- **Respect the modes.** The six spaces are cognitive contexts and
  relationships to time, not a linear pipeline. Serve the mode an idea is in.
- **Stay calm.** No urgency mechanics, vanity metrics, or volume incentives.
- **Let the tool recede.** Prefer the change that makes the idea more present
  and the interface quieter.

See [`PRODUCT.md`](./PRODUCT.md), [`DESIGN.md`](./DESIGN.md), and
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full rationale.

## Documentation

The foundation documents are the source of truth for direction, with
`README.md` at the root:

- `PRODUCT.md` — what we are building and why
- `DESIGN.md` — how it should feel and the principles behind it
- `ARCHITECTURE.md` — the technical direction and the product ontology
- `ROADMAP.md` — what comes next and in what order
- `CHANGELOG.md` — what has changed

When a change alters direction, update the relevant document in the same
change. Keep documents concise and serious — resist overbuilding them ahead of
the product.

## Commits

- Write clear, present-tense commit messages describing intent, not mechanics
  (e.g. "Add foundation documents" rather than "Add files").
- Keep each commit focused on one coherent change.
- Record notable changes in `CHANGELOG.md` under `[Unreleased]`.

## Working Agreement

Because there is no application code yet, the near-term priority is deciding
direction deliberately (see `ROADMAP.md`, Phase 0). Propose significant
technical or product decisions in writing before implementing them, so the
reasoning is preserved alongside the result.
