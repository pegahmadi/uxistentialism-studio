// Reads the Editorial Board projection (data/projections/editorial-board.json):
// a sanitized, human-curated snapshot of a completed Claude Editorial Board review
// that the Studio's Iteration view reads. It lives in data/projections/ (not
// data/studio/) because it is a projection of an EXTERNAL source's output — the
// same architectural role as the Obsidian projection — not your authored state.
//
// The app reads ONLY this committed file. It never calls the Claude API, never
// runs a review, and never reads a private transcript. The projection holds only
// short, public-safe diagnostic summaries — never the manuscript body, never keys.
//
// Server-only (fs). Never throws: returns null when the file is absent, malformed,
// or empty, so callers fall back to curated content.

import fs from "node:fs";
import path from "node:path";

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

function boardPath(): string {
  return path.join(process.cwd(), "data", "projections", "editorial-board.json");
}

/** Read + normalize the board projection. Never throws; null when unusable. */
export function getEditorialBoard(): EditorialBoard | null {
  let raw: unknown;
  try {
    const p = boardPath();
    if (!fs.existsSync(p)) return null;
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
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

  // A present-but-contentless file is treated as absent, so Iteration falls back.
  const hasContent =
    board.manuscript || board.reviewers.length || board.rulings.length || board.unresolvedQuestions.length || board.nextDecision;
  return hasContent ? board : null;
}

/** Whether a usable board projection is present (vs. curated fallback). */
export function boardSource(): "projection" | "none" {
  return getEditorialBoard() ? "projection" : "none";
}
