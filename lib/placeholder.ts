// Static placeholder content for the skeleton. No persistence, no real data.
//
// The shape here deliberately encodes one architectural commitment: an Idea is
// not owned by a mode. Each Idea records the modes it is currently *present in*
// (a view relationship), so the same Idea surfaces in several spaces at once.
// See ARCHITECTURE.md — modes are views/contexts, not containers.

import type { ModeSlug } from "./modes";

export interface Idea {
  id: string;
  title: string;
  thesis: string;
  /**
   * The modes this Idea is currently present in.
   *
   * Architectural note — presence, not ownership:
   *   - Modes are cognitive contexts, not containers; an Idea is never "in" one
   *     mode the way a file sits in a folder.
   *   - An Idea may be present in several modes simultaneously (hence a
   *     collection, not a single value).
   *   - Each entry represents the *current relationship* between this Idea and a
   *     mode — where it is being thought about right now — not where it lives.
   *
   * For the skeleton this is a declared list. Over time, presence is expected to
   * become a derived query (by recency, connection, or activity) rather than a
   * persisted field — see ARCHITECTURE.md. Not implemented yet; kept declarative.
   */
  presentIn: ModeSlug[];
  /** Optional trace of how the Idea has developed (placeholder lineage). */
  lineage?: string[];
}

export interface Observation {
  id: string;
  note: string;
  source: string;
}

export const IDEAS: Idea[] = [
  {
    id: "tool-recedes",
    title: "The tool that recedes",
    thesis:
      "Software for thinking should disappear the moment the thought arrives.",
    presentIn: ["today", "formation", "iteration"],
    lineage: [
      "A stray note: the best tools feel like nothing.",
      "Reframed as a design principle, not a feature.",
    ],
  },
  {
    id: "lineage-over-documents",
    title: "Lineage over documents",
    thesis: "A finished essay is a frozen view of a living idea.",
    presentIn: ["iteration", "distribution", "memory"],
    lineage: [
      "Started as a complaint about file-based tools.",
      "Sharpened: documents are snapshots, not the work itself.",
    ],
  },
  {
    id: "time-as-structure",
    title: "Time as structure",
    thesis:
      "Most knowledge tools treat time as metadata; here it should be architecture.",
    presentIn: ["field", "formation", "today"],
  },
  {
    id: "questions-first-class",
    title: "Questions as first-class",
    thesis: "Ideas are evolving answers to persistent questions.",
    presentIn: ["formation", "memory"],
  },
  {
    id: "calm-authority",
    title: "Calm authority",
    thesis: "An interface can hold attention without ever demanding it.",
    presentIn: ["iteration", "distribution"],
  },
];

export const OBSERVATIONS: Observation[] = [
  {
    id: "obs-retrieval",
    note: "Most note apps optimize retrieval, not maturation.",
    source: "Field note",
  },
  {
    id: "obs-gardens",
    note: "The garden and the stream are two different relationships to time.",
    source: "Essay",
  },
  {
    id: "obs-slow",
    note: "Slow media: ideas meant to be returned to, not consumed.",
    source: "Article",
  },
];

/** Ideas currently surfacing in a given mode. A view over the shared pool. */
export function ideasInMode(slug: ModeSlug): Idea[] {
  return IDEAS.filter((idea) => idea.presentIn.includes(slug));
}
