// Assembles the Iteration view deterministically. It answers exactly one governing
// question: "What still needs judgment?"
//
// Composes three sources, each marked with visible provenance:
//   - the Studio Workspace (authored)          → lib/workspace.ts
//   - the Editorial Board projection (projected) → lib/editorial-board.ts
//   - curated fallback (curated)                → lib/content.ts + CURATED_BOARD here
//
// Principles honored:
//   * The board ADVISES; you DECIDE. Rulings are your decisions, kept visually and
//     structurally distinct from reviewer recommendations.
//   * Disagreement is shown only when reviewer recommendations MATERIALLY differ —
//     never merely because more than one reviewer exists. A lone reviewer is
//     described neutrally, not called "convergence".
//   * A Workspace/board review-round mismatch is surfaced honestly, not silently
//     resolved by picking one.
//   * Never invents review or editorial state; degrades gracefully to curated
//     content when the projection is absent, partial, or malformed.

import { getWorkspace, workspaceSource } from "./workspace";
import { getEditorialBoard, boardSource, type Confidence } from "./editorial-board";
import { IDEAS } from "./content";
import type { DataSource } from "./data-result";

export const ITERATION_QUESTION = "What still needs judgment?";

export type EvidenceKind = "workspace" | "board" | "curated" | "derived";

export interface Evidence {
  kind: EvidenceKind;
  label: string;
  value?: string;
}

export interface ReviewerView {
  glyph: string;
  role: string;
  diagnosis: string | null;
  recommendation: string | null;
  confidence: Confidence | null;
}

export interface RulingView {
  on: string | null;
  decision: string;
}

export type BoardStance = "split" | "convergent" | "single" | "none";

export interface IterationView {
  question: string;
  manuscript: {
    id: string | null;
    title: string;
    round: number | null;
    status: string | null;
    venue: string | null;
    evidence: Evidence[];
  };
  /** Honest mismatch when Workspace and board disagree on the round (req 5). */
  roundMismatch: { workspace: number; board: number } | null;
  consequentialQuestion: { text: string; evidence: Evidence[] } | null;
  board: { stance: BoardStance; summary: string; reviewers: ReviewerView[]; evidence: Evidence[] };
  rulings: { items: RulingView[]; evidence: Evidence[] };
  nextDecision: { text: string; evidence: Evidence[] } | null;
  pastRounds: string[];
  sources: { workspace: "file" | "default"; board: "projection" | "none" };
  /** Data-layer provenance for the board snapshot (§8) — live / fallback / stale. */
  boardProvenance: { source: DataSource; lastSuccessfulSync: string | null; stale: boolean };
}

const REVIEWER_GLYPHS = ["▦", "❧", "◈", "⁙", "◇"];

const ev = (kind: EvidenceKind, label: string, value?: string): Evidence => ({ kind, label, ...(value ? { value } : {}) });

// Normalize a recommendation so trivial wording differences don't read as disagreement.
const normalizeRec = (s: string) =>
  s.toLowerCase().replace(/[\s.,;:!?—–-]+/g, " ").trim();

// The curated board shown when no projection is present — mirrors the hand-authored
// board so deleting the projection returns Iteration to its prior state.
const CURATED_BOARD = {
  reviewers: [
    { role: "Evidence", diagnosis: "This claim needs a documented case to stand on.", recommendation: "Ground §3 in one real case.", confidence: "high" as Confidence },
    { role: "Method", diagnosis: "You are theorizing ahead of observation.", recommendation: "Observe first; let evidence follow.", confidence: "medium" as Confidence },
  ],
  consequentialQuestion: "Does §3's mechanism need a documented case, or observation first?",
  rulings: [{ on: "Whether §3 requires a documented case", decision: "Evidence that follows observation persuades; evidence that precedes it decorates." }],
  nextDecision: "Rule on §3: require a documented case, or reframe as observation-first.",
};

function boardStance(reviewers: { recommendation: string | null }[]): { stance: BoardStance; summary: string } {
  const withRec = reviewers.filter((r) => r.recommendation);
  if (reviewers.length === 0) return { stance: "none", summary: "No board review yet." };
  if (reviewers.length === 1) return { stance: "single", summary: "One voice on the board — no second opinion yet." };
  const distinct = new Set(withRec.map((r) => normalizeRec(r.recommendation!)));
  if (distinct.size >= 2) return { stance: "split", summary: "The board is split — the recommendations diverge." };
  return { stance: "convergent", summary: "The board converges — the recommendations agree." };
}

export async function getIterationView(): Promise<IterationView> {
  // Snapshot rule (§8): one DataResult per source per request.
  const [wRes, boardRes] = await Promise.all([getWorkspace(), getEditorialBoard()]);
  const w = wRes.data;
  const board = boardRes.data;
  const wm = w.activeManuscript;

  const workspaceHasContent = Boolean(
    w.focus || w.activeManuscript || w.approvedFormationTopic || w.openQuestions.length || w.nextAction || w.todayNote || w.status || w.updatedAt,
  );
  const workspaceState: "file" | "default" = workspaceSource(wRes) === "file" && workspaceHasContent ? "file" : "default";

  // Curated fallback manuscript — the piece Iteration has always shown.
  const curatedIdea = IDEAS.find((i) => i.id === (wm?.id ?? board?.manuscript?.id ?? "authority-architecture")) ?? IDEAS.find((i) => i.presentIn.includes("iteration")) ?? IDEAS[0];

  // ---- MANUSCRIPT identity (Workspace authored → board projected → curated) ----
  const title = wm?.title ?? board?.manuscript?.title ?? curatedIdea?.title ?? "Untitled";
  const id = wm?.id ?? board?.manuscript?.id ?? curatedIdea?.id ?? null;
  const status = board?.manuscript?.status ?? w.status ?? null;
  const venue = wm?.venue ?? null;

  const wsRound = wm?.round ?? w.reviewRound;
  const boardRound = board?.manuscript?.reviewRound ?? null;
  let round: number | null;
  const manuscriptEvidence: Evidence[] = [];
  if (wm?.title || wm?.id) manuscriptEvidence.push(ev("workspace", "Active manuscript", "Workspace"));
  else if (board?.manuscript) manuscriptEvidence.push(ev("board", "From Editorial Board"));
  else manuscriptEvidence.push(ev("curated", "Curated"));

  // Round + honest mismatch (req 5).
  let roundMismatch: { workspace: number; board: number } | null = null;
  if (wsRound != null && boardRound != null && wsRound !== boardRound) {
    round = wsRound; // Workspace is authoritative for "what I'm working on"…
    roundMismatch = { workspace: wsRound, board: boardRound }; // …but we say the board reviewed a different one.
  } else {
    round = wsRound ?? boardRound;
  }
  if (round != null) manuscriptEvidence.push(ev(wsRound != null ? "workspace" : "board", "Round", String(round)));

  // ---- MOST CONSEQUENTIAL UNRESOLVED QUESTION (board[0] by convention) ----
  let consequentialQuestion: { text: string; evidence: Evidence[] } | null = null;
  if (board?.unresolvedQuestions.length) {
    consequentialQuestion = { text: board.unresolvedQuestions[0], evidence: [ev("board", "Projected from Editorial Board")] };
  } else if (!board) {
    consequentialQuestion = { text: CURATED_BOARD.consequentialQuestion, evidence: [ev("curated", "Curated")] };
  }

  // ---- BOARD reviewers + stance ----
  const rawReviewers = board ? board.reviewers : CURATED_BOARD.reviewers;
  const reviewers: ReviewerView[] = rawReviewers.map((r, i) => ({
    glyph: REVIEWER_GLYPHS[i % REVIEWER_GLYPHS.length],
    role: r.role ?? `Reviewer ${i + 1}`,
    diagnosis: r.diagnosis ?? null,
    recommendation: r.recommendation ?? null,
    confidence: r.confidence ?? null,
  }));
  const { stance, summary } = boardStance(reviewers);
  const boardEvidence: Evidence[] = [board ? ev("board", "Projected from Editorial Board", board.sourceLabel ?? undefined) : ev("curated", "Curated")];

  // ---- RULINGS — human decisions, kept distinct from recommendations ----
  // v1 authority rule (§2b): rulings render as human decisions only from the
  // human-curated committed fixture. Live board content is advice; the reader
  // already strips live rulings, and this guard keeps the rule visible here.
  const rulingItems: RulingView[] =
    board && boardRes.source !== "live"
      ? board.rulings.map((r) => ({ on: r.on, decision: r.decision }))
      : board
        ? []
        : CURATED_BOARD.rulings;
  const rulings = { items: rulingItems, evidence: [board ? ev("board", "Projected from Editorial Board") : ev("curated", "Curated")] };

  // ---- NEXT HUMAN DECISION ----
  let nextDecision: { text: string; evidence: Evidence[] } | null = null;
  if (board?.nextDecision) nextDecision = { text: board.nextDecision, evidence: [ev("board", "Projected from Editorial Board")] };
  else if (!board) nextDecision = { text: CURATED_BOARD.nextDecision, evidence: [ev("curated", "Curated")] };

  // ---- PAST ROUNDS — curated lineage ----
  const pastRounds = curatedIdea?.lineage ?? [];

  return {
    question: ITERATION_QUESTION,
    manuscript: { id, title, round, status, venue, evidence: manuscriptEvidence },
    roundMismatch,
    consequentialQuestion,
    board: { stance, summary, reviewers, evidence: boardEvidence },
    rulings,
    nextDecision,
    pastRounds,
    sources: { workspace: workspaceState, board: boardSource(boardRes) },
    boardProvenance: { source: boardRes.source, lastSuccessfulSync: boardRes.lastSuccessfulSync, stale: boardRes.stale },
  };
}
