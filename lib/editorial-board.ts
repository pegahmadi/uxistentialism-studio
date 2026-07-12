// Editorial Board reader — request-time Upstash Redis primary path with the
// committed fixture (data/projections/editorial-board.json) as fallback
// (contract §8). The fixture is a sanitized, human-curated snapshot of a
// completed board review; live values arrive through POST /api/ingest/
// editorial-board and hold only short, public-safe diagnostic summaries —
// never the manuscript body, never keys, never private transcripts.
//
// Authority rule (v1, §2b): live board content is ADVICE. The ingestion
// endpoint rejects every non-empty `rulings` array, and this reader
// additionally strips rulings from live data as defense in depth — rulings may
// render as human decisions only from the human-curated committed fixture.
//
// Server-only. Never throws: falls back when Redis/file are absent, malformed,
// or empty, so callers degrade to curated content.

import fs from "node:fs";
import path from "node:path";
import { getRedis, readSnapshot } from "@/lib/redis";
import { isStale, type DataResult } from "@/lib/data-result";

export const EDITORIAL_BOARD_SCHEMA_VERSION = 1;

export type Confidence = "low" | "medium" | "high";

export interface BoardManuscript {
  id: string | null;
  title: string | null;
  reviewRound: number | null;
  status: string | null;
}

export interface BoardReviewer {
  role: string | null;
  diagnosis: string | null;
  recommendation: string | null;
  confidence: Confidence | null;
}

export interface BoardRuling {
  on: string | null;
  decision: string; // a ruling is a decision record — it must carry a decision
}

export interface EditorialBoard {
  schemaVersion: number;
  manuscript: BoardManuscript | null;
  reviewedAt: string | null;
  reviewers: BoardReviewer[];
  unresolvedQuestions: string[];
  rulings: BoardRuling[];
  deferredThreads: string[];
  nextDecision: string | null;
  sourceLabel: string | null;
  updatedAt: string | null;
  updatedBy: "human" | "claude" | null;
}

export type EditorialBoardResult = DataResult<EditorialBoard | null>;

// ---- coercers: tolerate anything, only accept well-typed values ----

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter((s): s is string => s !== null);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function manuscript(v: unknown): BoardManuscript | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const m: BoardManuscript = {
    id: str(o.id),
    title: str(o.title),
    reviewRound: num(o.reviewRound),
    status: str(o.status),
  };
  return m.id || m.title || m.reviewRound != null || m.status ? m : null;
}

function reviewers(v: unknown): BoardReviewer[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((entry): BoardReviewer | null => {
      if (!entry || typeof entry !== "object") return null;
      const o = entry as Record<string, unknown>;
      const r: BoardReviewer = {
        role: str(o.role),
        diagnosis: str(o.diagnosis),
        recommendation: str(o.recommendation),
        confidence: oneOf<Confidence>(o.confidence, ["low", "medium", "high"]),
      };
      // Keep a reviewer only if it says something.
      return r.role || r.diagnosis || r.recommendation ? r : null;
    })
    .filter((x): x is BoardReviewer => x !== null);
}

function rulings(v: unknown): BoardRuling[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((entry): BoardRuling | null => {
      if (!entry || typeof entry !== "object") return null;
      const o = entry as Record<string, unknown>;
      const decision = str(o.decision);
      if (!decision) return null; // a ruling without a decision is not a ruling
      return { on: str(o.on), decision };
    })
    .filter((x): x is BoardRuling => x !== null);
}

/** Normalize any raw value into a usable board, or null when contentless. */
function normalize(raw: unknown): EditorialBoard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const board: EditorialBoard = {
    schemaVersion: num(o.schemaVersion) ?? EDITORIAL_BOARD_SCHEMA_VERSION,
    manuscript: manuscript(o.manuscript),
    reviewedAt: str(o.reviewedAt),
    reviewers: reviewers(o.reviewers),
    unresolvedQuestions: strArray(o.unresolvedQuestions),
    rulings: rulings(o.rulings),
    deferredThreads: strArray(o.deferredThreads),
    nextDecision: str(o.nextDecision),
    sourceLabel: str(o.sourceLabel),
    updatedAt: str(o.updatedAt),
    updatedBy: oneOf<"human" | "claude">(o.updatedBy, ["human", "claude"]),
  };

  // A present-but-contentless value is treated as absent, so Iteration falls back.
  const hasContent =
    board.manuscript || board.reviewers.length || board.rulings.length || board.unresolvedQuestions.length || board.nextDecision;
  return hasContent ? board : null;
}

function readFixture(): EditorialBoard | null {
  try {
    const p = path.join(process.cwd(), "data", "projections", "editorial-board.json");
    if (!fs.existsSync(p)) return null;
    return normalize(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch {
    return null;
  }
}

function fixtureResult(error: string | null): EditorialBoardResult {
  const fixture = readFixture();
  if (fixture) return { data: fixture, source: "fallback", lastSuccessfulSync: null, stale: true, error };
  return { data: null, source: "default", lastSuccessfulSync: null, stale: true, error };
}

/**
 * The one snapshot per request (§8): Redis primary, fixture fallback. Data +
 * metadata arrive in ONE atomic MGET (v1.1.2) so a concurrent ingestion can
 * never yield a mixed data/meta pair; never throws.
 */
export async function getEditorialBoard(): Promise<EditorialBoardResult> {
  const redis = getRedis();
  if (!redis) return fixtureResult(null); // unconfigured Redis is an explicit fallback condition

  let rawData: unknown;
  let rawMeta: unknown;
  try {
    ({ rawData, rawMeta } = await readSnapshot(redis, "editorial-board"));
  } catch {
    return fixtureResult("redis_unreachable");
  }

  if (typeof rawData === "string" && rawData.length) {
    try {
      const board = normalize(JSON.parse(rawData));
      if (board) {
        // v1 authority rule: live board content is advice only. Rulings render
        // as human decisions only from the committed fixture — never from Redis.
        board.rulings = [];
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
        return { data: board, source: "live", lastSuccessfulSync, stale: isStale(lastSuccessfulSync), error: null };
      }
    } catch {
      return fixtureResult("malformed_live_data");
    }
  }
  return fixtureResult(null); // reachable Redis, key absent → fixture
}

/** Whether a usable board projection is present (vs. curated fallback). */
export function boardSource(result: EditorialBoardResult): "projection" | "none" {
  return result.data ? "projection" : "none";
}
