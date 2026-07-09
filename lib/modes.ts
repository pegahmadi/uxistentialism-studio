// The six spaces of UXistentialism Studio.
//
// A Mode is a cognitive context and a relationship to time — NOT a container an
// Idea permanently lives in. This module is the single source of truth for the
// spaces: navigation, headers, and routing all read from MODES so the ontology
// lives in one place. See ARCHITECTURE.md — "Time and the Six Modes."

export const MODE_SLUGS = [
  "today",
  "field",
  "formation",
  "iteration",
  "distribution",
  "memory",
] as const;

export type ModeSlug = (typeof MODE_SLUGS)[number];

// A Mode is a cognitive context and a relationship to time — NOT an ownership
// container. An Idea is never "in" a single mode the way a file is in a folder:
//   - Modes are cognitive contexts, not containers that own Ideas.
//   - An Idea may be present in several modes at the same time.
//   - Presence is the *current relationship* between an Idea and a mode, not
//     where the Idea lives. See `Idea.presentIn` in lib/placeholder.ts.
export interface Mode {
  slug: ModeSlug;
  label: string;
  /** The question this space answers. */
  question: string;
  /** The mode's relationship to time. */
  time: string;
  /** The posture of thinking this space invites. */
  posture: string;
}

export const MODES: Mode[] = [
  {
    slug: "today",
    label: "Today",
    question: "Where should I spend my attention?",
    time: "The present",
    posture: "Orientation — a quiet read on where attention is best spent now.",
  },
  {
    slug: "field",
    label: "Field",
    question: "What is happening in the world?",
    time: "The ongoing present",
    posture: "Observing — gathering signals and sources as they stream in.",
  },
  {
    slug: "formation",
    label: "Formation",
    question: "What is worth writing?",
    time: "The not-yet",
    posture: "Shaping — turning attention into a thesis worth pursuing.",
  },
  {
    slug: "iteration",
    label: "Iteration",
    question: "How do I strengthen this work?",
    time: "The near past, reopened",
    posture: "Developing — revisiting an idea to make it more considered.",
  },
  {
    slug: "distribution",
    label: "Distribution",
    question: "How should this idea travel?",
    time: "The moment of release",
    posture: "Composing — shaping how a thought reaches other people.",
  },
  {
    slug: "memory",
    label: "Memory",
    question: "What has this work become?",
    time: "The accumulated past",
    posture: "Reflecting — seeing what an idea accumulated into over time.",
  },
];

const MODE_BY_SLUG: Record<ModeSlug, Mode> = MODES.reduce(
  (acc, mode) => {
    acc[mode.slug] = mode;
    return acc;
  },
  {} as Record<ModeSlug, Mode>,
);

export function getMode(slug: string): Mode | undefined {
  return (MODE_BY_SLUG as Record<string, Mode>)[slug];
}

export function isModeSlug(slug: string): slug is ModeSlug {
  return slug in MODE_BY_SLUG;
}
