// Field Research (WS-Field-Research) — the one research read path.
//
// There is no live research provider in v1 (WORKSTREAM.md, frozen scope §6):
// this module returns clearly-labelled SAMPLE data through the same DataResult
// provenance language the rest of the Studio uses (contract §8).
// `source: "default"` is the curated in-code tier — exactly where
// lib/content.ts sits. When a live provider exists it becomes the primary
// path and this sample becomes the last-resort default; the UI label follows
// `source` and never presents sample data as live.
//
// A finding with no attributable source is not shown (frozen scope §2) — the
// type makes the source mandatory and attributableFindings() enforces it at
// the boundary against malformed data.

import type { DataResult } from "@/lib/data-result";

export type FindingLevel = "high" | "medium" | "low";

export interface ResearchFinding {
  id: string;
  title: string;
  summary: string;
  /** Attributable origin — mandatory. A finding without one is not shown. */
  source: { title: string; url: string };
  relevance: FindingLevel;
  confidence: FindingLevel;
}

export interface ResearchBrief {
  findings: ResearchFinding[];
}

export type ResearchBriefResult = DataResult<ResearchBrief>;

// Sample findings, tuned to Field's governing question ("what is happening in
// the world?") and the signals already gathering there. Source URLs are
// deliberately example.com — the sample label is honest all the way down; no
// invented attribution to a real publication.
const SAMPLE_BRIEF: ResearchBrief = {
  findings: [
    {
      id: "agent-approval-queues",
      title: "Agent-driven design tools are shipping approval queues",
      summary:
        "Early agent features in design tools route proposed changes into review inboxes rather than applying them directly. The approval surface — not the canvas — is becoming the artifact where design authority is exercised.",
      source: { title: "Approval queues in agent-native tooling", url: "https://example.com/agent-approval-queues" },
      relevance: "high",
      confidence: "medium",
    },
    {
      id: "provenance-in-design-systems",
      title: "Provenance metadata appearing in production design systems",
      summary:
        "Component libraries are starting to record who — or what — authored a change, alongside the change itself. Authorship provenance is moving from etiquette to infrastructure.",
      source: { title: "Provenance fields in component pipelines", url: "https://example.com/provenance-in-design-systems" },
      relevance: "high",
      confidence: "low",
    },
    {
      id: "mcp-registries",
      title: "MCP servers consolidating into registries",
      summary:
        "The tool-access layer for agents is centralizing into curated registries. Authority over what an agent may reach is quietly moving to registry maintainers — an authority surface hiding inside plumbing.",
      source: { title: "Registry consolidation in the agent tool layer", url: "https://example.com/mcp-registries" },
      relevance: "medium",
      confidence: "medium",
    },
    {
      id: "craft-to-governance",
      title: "Design leadership discourse shifting from craft to governance",
      summary:
        "Hiring posts and conference programs increasingly frame senior design work as owning decision rights and review structures rather than producing artifacts.",
      source: { title: "Governance language in design leadership roles", url: "https://example.com/craft-to-governance" },
      relevance: "medium",
      confidence: "low",
    },
  ],
};

/**
 * The one research snapshot per request (§8 snapshot rule). Always the curated
 * sample in v1: no live provider, no fixture, no Redis key — introducing any
 * of those is out of this workstream's frozen scope.
 */
export async function getResearchBrief(): Promise<ResearchBriefResult> {
  // Not a synced source in v1: lastSuccessfulSync null / stale true by
  // definition (same rule as lib/workspace.ts) — it must never appear fresh.
  return { data: SAMPLE_BRIEF, source: "default", lastSuccessfulSync: null, stale: true, error: null };
}

/** Frozen scope §2: a finding with no attributable source is not shown. */
export function attributableFindings(brief: ResearchBrief): ResearchFinding[] {
  return brief.findings.filter(
    (f) => typeof f.source?.title === "string" && f.source.title.trim().length > 0 && typeof f.source?.url === "string" && f.source.url.trim().length > 0,
  );
}
