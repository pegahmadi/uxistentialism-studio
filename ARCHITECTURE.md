# Architecture

This document describes the initial technical direction. It is deliberately
lightweight — the product's shape is still being validated, and the
architecture should follow the product, not lead it. Treat everything here as a
starting hypothesis to be revised.

Its purpose is to encode the **ontology** of UXistentialism Studio explicitly,
so that later implementation decisions naturally reinforce what makes the
product distinct: the maturation of ideas over time, held together by their
connections and their history.

## Guiding Constraints

- **The Idea is the primary object.** The architecture is organized around
  ideas as they mature, not around documents, files, or notes. Magnolia's
  primitive is a Decision; UXistentialism's is an **Idea**. Everything else in
  the model exists to support an idea's development.
- **Connections are first-class data.** Relationships between ideas,
  observations, sources, and discussions are stored as primary entities, not
  derived at render time. The graph is *one interface over these connections*,
  not a feature layered on later.
- **Continuity over documents.** Documents are outputs; **lineage is the
  product**. The architecture preserves the evolution of an idea — how it
  changed and what it accumulated — as the durable artifact. History is
  append-only and never overwritten.
- **Time is a dimension of the model, not metadata.** The six spaces are
  different relationships to time and different modes of thinking, not folders.
  Temporality is encoded in the domain, not bolted on as timestamps.
- **The six spaces are modes, not pipeline stages.** An idea does not progress
  linearly through stages; it moves between cognitive contexts as it develops,
  in any direction.
- **Local-first, low-friction.** Thinking tools must be fast and always
  available. Keep the user's work responsive and close at hand before
  introducing network dependencies.

## Core Domain Concepts

The data model is provisional and will be defined properly as the product is
built. The central entities:

- **Idea** — the primary object. A unit of intellectual work that persists
  across its entire life and matures over time. An Idea is not a document; the
  essays, posts, and artifacts it produces are *outputs of* an Idea, not the
  Idea itself.
- **Connection** — a first-class, typed relationship between an Idea and
  another entity (another Idea, an Observation, a Source, a Discussion).
  Connections carry meaning (e.g. *informed-by*, *responds-to*, *develops*) and
  are the substrate the graph interface reads from.
- **Observation** — something noticed and captured, typically in the Field. Raw
  input that can connect to and feed an Idea.
- **Source** — external material an Idea engages with: a book, essay, article,
  or reference.
- **Discussion** — an exchange or conversation that shapes an Idea.
- **Lineage** — the append-only history of an Idea: how it moved between modes,
  what connections it formed, and what it became. Lineage is what makes Memory
  possible and is treated as the product's core artifact.
- **Mode** — the space an Idea currently occupies (Today, Field, Formation,
  Iteration, Distribution, Memory). A Mode is a cognitive context and a
  relationship to time, not a position in a pipeline. An Idea can occupy or
  return to any Mode.

## Time and the Six Modes

Each of the six spaces expresses a distinct relationship to time. Encoding this
in the model — rather than treating the spaces as containers — is one of the
things that differentiates the Studio from existing knowledge-management tools.

| Mode | Relationship to time |
|---|---|
| **Today** | The present — where attention is now |
| **Field** | The ongoing present — the world as it streams in |
| **Formation** | The not-yet — what is emerging into a thesis |
| **Iteration** | The near past, reopened — work being strengthened |
| **Distribution** | The moment of release — how an idea enters time |
| **Memory** | The accumulated past — what an idea has become |

## Technical Direction

The `.gitignore` and ecosystem point to a TypeScript web stack, which is the
working assumption:

- **Language:** TypeScript throughout, for a shared model across UI and data.
- **Client:** A modern web application. Framework choice (e.g. a React-based
  stack with Vite or Next.js) is open and will be decided when scaffolding
  begins.
- **Persistence:** Start local-first (the user's work lives close to them). The
  store must represent ideas, connections, and append-only lineage natively —
  a graph-shaped model, not a document store retrofitted with links. Sync and
  multi-device support are later concerns, layered on without changing the
  domain.
- **Structure:** Organize by the domain (Idea, Connection, Lineage, Mode) and
  by mode, not by framework convention alone.

## Deferred Decisions

- Concrete framework, build tooling, and package manager.
- Storage engine and sync strategy (with the constraint that it must model
  connections and lineage as first-class, not as an afterthought).
- Authentication and any multi-user model.
- Whether distribution integrates with external platforms or exports only.

_No application code exists yet. This document sets direction so that the first
scaffold is a deliberate choice rather than a default._
