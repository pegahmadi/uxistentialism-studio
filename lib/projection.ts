// Reads the sanitized Obsidian projection (data/projections/obsidian.json) and
// exposes it to the app — falling back to the hand-curated lib/content.ts when
// the projection is absent. Server-only (uses fs); the projection is read at
// build time, so production never touches the live vault.

import fs from "node:fs";
import path from "node:path";
import {
  IDEAS,
  GRAPH_NODES,
  GRAPH_EDGES,
  SIGNALS,
  WRITING,
  PRODUCTS,
  QUESTIONS,
  type GraphNode,
  type GraphEdge,
  type NodeKind,
} from "@/lib/content";

interface ProjectionConcept {
  id: string;
  title: string;
  kind: string;
  category: string;
  summary: string;
  presentIn: string[];
  backlinks: number;
}
interface Projection {
  generatedAt: string;
  concepts: ProjectionConcept[];
  connections: { from: string; to: string }[];
  emerging: { term: string; references: number }[];
}

function loadProjection(): Projection | null {
  try {
    const p = path.join(process.cwd(), "data", "projections", "obsidian.json");
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as Projection;
    return j?.concepts?.length ? j : null;
  } catch {
    return null;
  }
}

export function projectionSource(): "vault" | "curated" {
  return loadProjection() ? "vault" : "curated";
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Concept nodes/edges come from the vault projection when present; the peripheral
// nodes (signals, product, essays, questions) always come from curated content.
export function getGraph(): GraphModel {
  const proj = loadProjection();
  const conceptNodes: GraphNode[] = proj
    ? proj.concepts.map((c) => ({ id: c.id, label: c.title, kind: "concept" as NodeKind }))
    : IDEAS.map((i) => ({ id: i.id, label: i.title, kind: "concept" as NodeKind }));
  const conceptIds = new Set(conceptNodes.map((n) => n.id));

  const conceptEdges: GraphEdge[] = proj
    ? proj.connections.map((e) => ({ from: e.from, to: e.to }))
    : GRAPH_EDGES.filter((e) => conceptIds.has(e.from) && conceptIds.has(e.to));

  const peripheral = GRAPH_NODES.filter((n) => n.kind !== "concept");
  const peripheralEdges = GRAPH_EDGES.filter((e) => !(conceptIds.has(e.from) && conceptIds.has(e.to)));

  let nodes = [...conceptNodes, ...peripheral];
  const nodeIds = new Set(nodes.map((n) => n.id));
  let edges = [...conceptEdges, ...peripheralEdges].filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  // drop peripheral nodes that ended up unconnected (e.g. edges to non-allowlisted concepts)
  const connected = new Set<string>();
  edges.forEach((e) => {
    connected.add(e.from);
    connected.add(e.to);
  });
  nodes = nodes.filter((n) => n.kind === "concept" || connected.has(n.id));
  const finalIds = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => finalIds.has(e.from) && finalIds.has(e.to));

  return { nodes, edges };
}

export type NodeDetail = { stat: string; body: string; links: string };

export function getGraphDetails(): Record<string, NodeDetail> {
  const proj = loadProjection();
  const out: Record<string, NodeDetail> = {};

  if (proj) {
    for (const c of proj.concepts) {
      out[c.id] = {
        stat: `${c.backlinks} backlinks in the vault`,
        body: c.summary,
        links: `present in: ${c.presentIn.join(" · ")}`,
      };
    }
  } else {
    for (const i of IDEAS) {
      out[i.id] = { stat: `${i.presentIn.length} environments`, body: i.thesis, links: `present in: ${i.presentIn.join(" · ")}` };
    }
  }

  for (const s of SIGNALS) out[s.id] = { stat: "signal · the ongoing world", body: s.note, links: "feeds: Formation" };
  for (const w of WRITING) out[w.id] = { stat: `${w.form} · ${w.status}`, body: w.summary, links: w.venue ? `venue: ${w.venue}` : "" };
  for (const p of PRODUCTS) out[p.id] = { stat: "product · case study", body: p.summary, links: "" };
  for (const q of QUESTIONS) {
    const detail = { stat: "open question", body: q.text, links: "" };
    out[q.id] = detail;
    out[`q-${q.id.replace(/^q-/, "")}`] = detail;
  }
  return out;
}

export function getEmerging(): { term: string; references: number }[] {
  return loadProjection()?.emerging ?? [];
}

export interface ConceptView {
  id: string;
  title: string;
  summary: string;
  backlinks: number;
  presentIn: string[];
  source: "vault" | "curated";
}

export function getConcepts(): ConceptView[] {
  const proj = loadProjection();
  if (proj) {
    return proj.concepts.map((c) => ({
      id: c.id,
      title: c.title,
      summary: c.summary,
      backlinks: c.backlinks,
      presentIn: c.presentIn,
      source: "vault",
    }));
  }
  return IDEAS.map((i) => ({ id: i.id, title: i.title, summary: i.thesis, backlinks: 0, presentIn: i.presentIn, source: "curated" }));
}

export function getConcept(id: string): ConceptView | null {
  return getConcepts().find((c) => c.id === id) ?? null;
}
