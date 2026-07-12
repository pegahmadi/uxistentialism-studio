// Obsidian projection reader — request-time Upstash Redis primary path with the
// committed fixture (data/projections/obsidian.json) as fallback and the
// hand-curated lib/content.ts as the final default (contract §8).
//
// Snapshot rule (§8): pages load ONE ProjectionResult per request via
// getProjection() and derive every view (graph, details, concepts, emerging)
// from that single snapshot with pure functions. No module-scope reads.
//
// Server-only. lib readers only GET from Redis; they never write.

import fs from "node:fs";
import path from "node:path";
import { getRedis } from "@/lib/redis";
import { isStale, type DataResult } from "@/lib/data-result";
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
export interface Projection {
  generatedAt: string;
  concepts: ProjectionConcept[];
  connections: { from: string; to: string }[];
  emerging: { term: string; references: number }[];
}

export type ProjectionResult = DataResult<Projection | null>;

// Readers select the fields they know and tolerate unknown fixture fields (§12);
// a projection without concepts is unusable and treated as absent.
function usable(raw: unknown): Projection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const j = raw as Projection;
  return Array.isArray(j.concepts) && j.concepts.length ? j : null;
}

function readFixture(): Projection | null {
  try {
    const p = path.join(process.cwd(), "data", "projections", "obsidian.json");
    if (!fs.existsSync(p)) return null;
    return usable(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch {
    return null;
  }
}

function fixtureResult(error: string | null): ProjectionResult {
  const fixture = readFixture();
  if (fixture) return { data: fixture, source: "fallback", lastSuccessfulSync: null, stale: true, error };
  return { data: null, source: "default", lastSuccessfulSync: null, stale: true, error };
}

/**
 * The one snapshot per request (§8): Redis primary, fixture fallback, curated
 * default. One data read + one metadata read; never throws.
 */
export async function getProjection(): Promise<ProjectionResult> {
  const redis = getRedis();
  if (!redis) return fixtureResult(null); // unconfigured Redis is an explicit fallback condition

  let rawData: unknown;
  let rawMeta: unknown;
  try {
    [rawData, rawMeta] = await Promise.all([
      redis.get("obsidian-projection"),
      redis.get("obsidian-projection-meta"),
    ]);
  } catch {
    return fixtureResult("redis_unreachable");
  }

  if (typeof rawData === "string" && rawData.length) {
    try {
      const data = usable(JSON.parse(rawData));
      if (data) {
        let lastSuccessfulSync: string | null = null;
        if (typeof rawMeta === "string" && rawMeta.length) {
          try {
            const meta: unknown = JSON.parse(rawMeta);
            if (meta && typeof meta === "object") {
              const v = (meta as Record<string, unknown>).lastSuccessfulSync;
              if (typeof v === "string") lastSuccessfulSync = v;
            }
          } catch {
            /* missing/invalid metadata must never appear fresh — stays null */
          }
        }
        return { data, source: "live", lastSuccessfulSync, stale: isStale(lastSuccessfulSync), error: null };
      }
    } catch {
      return fixtureResult("malformed_live_data");
    }
  }
  return fixtureResult(null); // reachable Redis, key absent → fixture
}

/** "vault" when a projection (live or fixture) is present; "curated" otherwise. */
export function projectionSource(result: ProjectionResult): "vault" | "curated" {
  return result.data ? "vault" : "curated";
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Concept nodes/edges come from the vault projection when present; the peripheral
// nodes (signals, product, essays, questions) always come from curated content.
export function getGraph(result: ProjectionResult): GraphModel {
  const proj = result.data;
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

export function getGraphDetails(result: ProjectionResult): Record<string, NodeDetail> {
  const proj = result.data;
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

export function getEmerging(result: ProjectionResult): { term: string; references: number }[] {
  return result.data?.emerging ?? [];
}

export interface ConceptView {
  id: string;
  title: string;
  summary: string;
  backlinks: number;
  presentIn: string[];
  source: "vault" | "curated";
}

export function getConcepts(result: ProjectionResult): ConceptView[] {
  const proj = result.data;
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

export function getConcept(result: ProjectionResult, id: string): ConceptView | null {
  return getConcepts(result).find((c) => c.id === id) ?? null;
}
