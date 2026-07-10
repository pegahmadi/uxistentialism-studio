// Curated content — a hand-authored *projection of the vault*, not the vault.
//
// This is deliberately NOT wired to Obsidian. It is a small, curated slice of
// real UXistentialism material so the Studio feels like a real intellectual
// world rather than a demo. The goal is not completeness.
//
// The ontology commitment holds: modes are views/contexts, not containers. Each
// item declares the modes it is currently `presentIn`, so the same Idea can
// surface in several modes at once. See ARCHITECTURE.md.

import type { ModeSlug } from "./modes";

export interface Idea {
  id: string;
  title: string;
  thesis: string;
  presentIn: ModeSlug[];
  lineage?: string[];
}

export interface Product {
  id: string;
  title: string;
  summary: string;
  presentIn: ModeSlug[];
}

export interface Writing {
  id: string;
  title: string;
  form: "essay" | "series";
  venue?: "Medium" | "Substack";
  status: "published" | "in progress";
  summary: string;
  presentIn: ModeSlug[];
}

export interface Signal {
  id: string;
  title: string;
  note: string;
  presentIn: ModeSlug[];
}

export interface Question {
  id: string;
  text: string;
  presentIn: ModeSlug[];
}

export const IDEAS: Idea[] = [
  {
    id: "authority-architecture",
    title: "Authority Architecture",
    thesis:
      "Governance for AI-native systems is an architecture problem: authority has to be designed, placed, and made legible — not assumed.",
    presentIn: ["today", "iteration", "memory"],
    lineage: [
      "Began as frustration with 'human-in-the-loop' used as a slogan.",
      "Reframed as: authority must be placed, not assumed.",
      "Became a series — and the backbone of Magnolia.",
    ],
  },
  {
    id: "agency-stack",
    title: "Agency Stack",
    thesis:
      "Agency in AI systems is layered — each layer delegates and escalates. Naming the stack shows where human judgment must sit.",
    presentIn: ["iteration", "formation"],
    lineage: [
      "A sketch of where delegation actually happens in AI systems.",
      "Named as layers so we can point at where judgment belongs.",
    ],
  },
  {
    id: "escalation-architecture",
    title: "Escalation Architecture",
    thesis:
      "Not every decision should be automated equally. Escalation is the mechanism that routes a decision to the right level of authority.",
    presentIn: ["today", "iteration"],
    lineage: [
      "Started as 'not every decision is equal'.",
      "Formalized into tiers that route decisions to the right authority.",
    ],
  },
  {
    id: "governance-debt",
    title: "Governance Debt",
    thesis:
      "Every ungoverned automation accrues debt — the deferred cost of decisions no one owns. It compounds quietly, like technical debt.",
    presentIn: ["formation", "iteration"],
    lineage: [
      "Noticed automations that no one actually owned.",
      "Named the deferred cost: debt that compounds in the dark.",
    ],
  },
  {
    id: "decision-memory",
    title: "Decision Memory",
    thesis:
      "Systems forget why. Decision memory treats the record of a choice — its reasoning and its authority — as first-class, not a side effect.",
    presentIn: ["today", "formation"],
  },
  {
    id: "human-judgment",
    title: "Human Judgment",
    thesis:
      "The scarce resource in AI-native work isn't production; it's judgment. Keeping humans in the loop means keeping them in practice.",
    presentIn: ["today", "formation"],
  },
  {
    id: "design-systems-decision-systems",
    title: "Design Systems Becoming Decision Systems",
    thesis:
      "Design systems stopped being libraries of components and became systems that make decisions. That shift changes what governance means.",
    presentIn: ["field", "iteration", "memory"],
    lineage: [
      "An observation: design systems are absorbing decisions.",
      "Grew into a thesis about what governance now has to cover.",
    ],
  },
];

export const PRODUCTS: Product[] = [
  {
    id: "magnolia",
    title: "Magnolia",
    summary:
      "A Figma plugin for design-decision capture and governance — the production case study for Authority Architecture. It records why a divergence exists, who owns it, and whether it should become precedent.",
    presentIn: ["today", "distribution", "memory"],
  },
];

export const WRITING: Writing[] = [
  {
    id: "production-has-primitives",
    title: "Production Has Primitives. Judgment Doesn't.",
    form: "essay",
    venue: "Medium",
    status: "published",
    summary:
      "Tooling keeps reducing the cost of production; judgment has no primitives, so it becomes the real bottleneck.",
    presentIn: ["distribution", "memory"],
  },
  {
    id: "dear-human",
    title: "Dear Human, You Are Still in the Loop but Out of Practice.",
    form: "essay",
    venue: "Medium",
    status: "published",
    summary:
      "Being 'in the loop' is not the same as being in practice. Automation can quietly deskill the humans it depends on.",
    presentIn: ["distribution", "memory"],
  },
  {
    id: "the-agency-layer",
    title: "The Agency Layer",
    form: "essay",
    venue: "Medium",
    status: "published",
    summary:
      "Building governance into AI-native systems means naming the layer where agency is delegated — and where it must return to a person.",
    presentIn: ["distribution", "memory"],
  },
  {
    id: "authority-architecture-series",
    title: "Authority Architecture (series)",
    form: "series",
    venue: "Medium",
    status: "in progress",
    summary:
      "The through-line: designing where authority lives in AI-native systems, from escalation tiers to the human authority layer.",
    presentIn: ["iteration", "distribution", "memory"],
  },
  {
    id: "a-slot-for-the-human",
    title: "A Slot for the Human in the System",
    form: "essay",
    status: "in progress",
    summary:
      "If the human is essential, the system should have a designed place for them — not a disclaimer that they were consulted.",
    presentIn: ["today", "formation", "distribution"],
  },
];

export const SIGNALS: Signal[] = [
  {
    id: "cursor",
    title: "Cursor",
    note: "AI-native editors move judgment upstream into prompts and review — production gets cheaper, decisions get denser.",
    presentIn: ["field"],
  },
  {
    id: "mcp",
    title: "MCP",
    note: "The Model Context Protocol standardizes how agents reach tools — an authority surface hiding inside plumbing.",
    presentIn: ["field"],
  },
  {
    id: "figma-automation",
    title: "Figma automation",
    note: "Design tools are gaining agents. The open question: who approves what the agent designs?",
    presentIn: ["field"],
  },
  {
    id: "ai-code-generation",
    title: "AI code generation",
    note: "As production approaches free, the bottleneck moves to deciding what is worth producing at all.",
    presentIn: ["field"],
  },
  {
    id: "design-systems-decision-systems-signal",
    title: "Design systems becoming decision systems",
    note: "Evidence that component systems are absorbing decision-making responsibility — and the governance that implies.",
    presentIn: ["field"],
  },
];

export const QUESTIONS: Question[] = [
  {
    id: "where-authority",
    text: "Where should authority live in an AI-native system?",
    presentIn: ["today", "formation"],
  },
  {
    id: "what-remembered",
    text: "What should the system remember, and why?",
    presentIn: ["today", "formation"],
  },
  {
    id: "worth-writing",
    text: "What is worth writing right now?",
    presentIn: ["formation"],
  },
];

export const ideasInMode = (slug: ModeSlug) => IDEAS.filter((i) => i.presentIn.includes(slug));
export const productsInMode = (slug: ModeSlug) => PRODUCTS.filter((p) => p.presentIn.includes(slug));
export const writingInMode = (slug: ModeSlug) => WRITING.filter((w) => w.presentIn.includes(slug));
export const signalsInMode = (slug: ModeSlug) => SIGNALS.filter((s) => s.presentIn.includes(slug));
export const questionsInMode = (slug: ModeSlug) => QUESTIONS.filter((q) => q.presentIn.includes(slug));

// ── Concept relationships ──────────────────────────────────────────────────
// The substrate for the Field graph and the Formation convergence. Additive to
// the model; ids reference the entities above. This is the app-side echo of the
// vault's link graph — connections are first-class, not a visualization bolted on.

export type NodeKind = "concept" | "signal" | "essay" | "product" | "question";

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export const GRAPH_NODES: GraphNode[] = [
  ...IDEAS.map((i) => ({ id: i.id, label: i.title, kind: "concept" as const })),
  { id: "magnolia", label: "Magnolia", kind: "product" },
  ...SIGNALS.map((s) => ({ id: s.id, label: s.title, kind: "signal" as const })),
  { id: "the-agency-layer", label: "The Agency Layer", kind: "essay" },
  { id: "authority-architecture-series", label: "Authority Architecture", kind: "essay" },
  { id: "q-where-authority", label: "Where should authority live?", kind: "question" },
  { id: "q-what-remembered", label: "What should the system remember?", kind: "question" },
];

export const GRAPH_EDGES: GraphEdge[] = [
  { from: "authority-architecture", to: "escalation-architecture" },
  { from: "authority-architecture", to: "agency-stack" },
  { from: "authority-architecture", to: "governance-debt" },
  { from: "authority-architecture", to: "human-judgment" },
  { from: "governance-debt", to: "decision-memory" },
  { from: "escalation-architecture", to: "human-judgment" },
  { from: "design-systems-decision-systems", to: "governance-debt" },
  { from: "design-systems-decision-systems", to: "design-systems-decision-systems-signal" },
  { from: "magnolia", to: "authority-architecture" },
  { from: "magnolia", to: "decision-memory" },
  { from: "magnolia", to: "governance-debt" },
  { from: "the-agency-layer", to: "agency-stack" },
  { from: "authority-architecture-series", to: "authority-architecture" },
  { from: "authority-architecture-series", to: "escalation-architecture" },
  { from: "cursor", to: "human-judgment" },
  { from: "ai-code-generation", to: "human-judgment" },
  { from: "mcp", to: "authority-architecture" },
  { from: "figma-automation", to: "design-systems-decision-systems" },
  { from: "q-where-authority", to: "authority-architecture" },
  { from: "q-where-authority", to: "escalation-architecture" },
  { from: "q-what-remembered", to: "decision-memory" },
  { from: "q-what-remembered", to: "governance-debt" },
];

export const nodeById = (id: string) => GRAPH_NODES.find((n) => n.id === id);

export const neighborsOf = (id: string) =>
  GRAPH_EDGES.filter((e) => e.from === id || e.to === id).map((e) =>
    e.from === id ? e.to : e.from,
  );

