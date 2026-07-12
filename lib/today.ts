// Assembles the Today briefing deterministically from real Studio data:
//   - the Workspace (authored state)            → lib/workspace.ts
//   - the Obsidian projection (derived data)     → lib/projection.ts
//   - Formation's emerging concepts (derived)    → lib/projection.ts
//   - unresolved questions (curated/authored)    → lib/content.ts
//
// It answers exactly one governing question: "What deserves my attention today?"
//
// Principles honored here:
//   * Deterministic templates only — NO AI-generated prose, no randomness.
//   * Every recommendation carries STRUCTURED provenance (see Evidence), so the
//     interface can show the evidence rather than a generic "because" sentence.
//   * Honesty: authored Workspace state is marked distinct from derived data. We
//     never claim overnight/temporal activity we can't support, and never invent
//     review or editorial state (that is a later milestone).
//   * Graceful fallback: with no Workspace and no projection, it still returns a
//     coherent briefing from curated content — never nulls or implementation talk.

import { getWorkspace, workspaceSource } from "./workspace";
import { getConcepts, getEmerging, getProjection, projectionSource } from "./projection";
import { getEditorialBoard } from "./editorial-board";
import { QUESTIONS, IDEAS, SIGNALS } from "./content";
import type { DataSource } from "./data-result";

export const TODAY_QUESTION = "What deserves my attention today?";

// A Formation term at/above this reference count is described as having "crossed
// the threshold" rather than merely "emerging". Derived from the vault projection.
const THRESHOLD_REFERENCES = 5;

export type EvidenceKind =
  | "workspace-focus"
  | "workspace-action"
  | "workspace-note"
  | "formation-approved"
  | "formation-status"
  | "manuscript"
  | "board"
  | "backlinks"
  | "question-source"
  | "curated";

export interface Evidence {
  kind: EvidenceKind;
  /** Human label, e.g. "Selected in Workspace", "Crossed threshold in Formation". */
  label: string;
  /** Optional detail, e.g. "Round 3", "7 references", "37 backlinks". */
  value?: string;
  /** false = authored by you (Workspace); true = derived from the projection/curated. */
  derived: boolean;
}

export interface BriefingItem {
  text: string;
  href?: string;
  evidence: Evidence[];
}

/** Data-layer provenance for one synced source (contract §8) — shown by the UI. */
export interface SyncProvenance {
  source: DataSource;
  lastSuccessfulSync: string | null;
  stale: boolean;
}

export interface TodayBriefing {
  question: string;
  focus: BriefingItem | null;
  movement: BriefingItem | null;
  openQuestion: BriefingItem | null;
  action: BriefingItem | null;
  note: BriefingItem | null;
  sources: { workspace: "file" | "default"; projection: "vault" | "curated"; board: "editorial-board" | "none" };
  /** live / fallback / stale indicators per data source — never silently degraded. */
  provenance: { projection: SyncProvenance; board: SyncProvenance };
  updated: { at: string; by: string | null } | null;
}

const ev = (kind: EvidenceKind, label: string, derived: boolean, value?: string): Evidence => ({
  kind,
  label,
  derived,
  ...(value ? { value } : {}),
});

const slugify = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "-");
const titleCase = (s: string) =>
  s.replace(/\b\w/g, (m) => m.toUpperCase());
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function formationStatus(references: number): Evidence {
  const crossed = references >= THRESHOLD_REFERENCES;
  return ev(
    "formation-status",
    crossed ? "Crossed threshold in Formation" : "Emerging in Formation",
    true,
    plural(references, "reference"),
  );
}

export async function getTodayBriefing(): Promise<TodayBriefing> {
  // Snapshot rule (§8): one DataResult per source per request; every view below
  // is a pure derivation over these three snapshots.
  const [wRes, projection, boardRes] = await Promise.all([getWorkspace(), getProjection(), getEditorialBoard()]);
  const w = wRes.data;
  const hasVault = projectionSource(projection) === "vault";
  const emerging = [...getEmerging(projection)].sort((a, b) => b.references - a.references);
  const concepts = [...getConcepts(projection)].sort((a, b) => b.backlinks - a.backlinks);

  // Today reads the Editorial Board projection ONLY to detect whether the active
  // manuscript has an unresolved judgment — never to surface the judgment itself.
  // The decision stays in Iteration; Today just points there. (Boundary: Today
  // answers "what deserves attention", Iteration answers "what still needs judgment".)
  const board = boardRes.data;
  const activeKey = w.activeManuscript ? slugify(w.activeManuscript.id ?? w.activeManuscript.title ?? "") : "";
  const boardKey = board?.manuscript ? slugify(board.manuscript.id ?? board.manuscript.title ?? "") : "";
  const pendingJudgment =
    Boolean(board) && !!activeKey && activeKey === boardKey && (board!.unresolvedQuestions.length > 0 || !!board!.nextDecision);

  // Track subjects already spent so later slots don't repeat the focus.
  const used = new Set<string>();

  // Resolve an approved Formation topic to a live emerging term or concept.
  const approved = (() => {
    if (!w.approvedFormationTopic) return null;
    const slug = slugify(w.approvedFormationTopic);
    const em = emerging.find((e) => slugify(e.term) === slug);
    if (em) return { key: slug, label: titleCase(em.term), references: em.references };
    const c = concepts.find((x) => x.id === slug);
    if (c) return { key: c.id, label: c.title, backlinks: c.backlinks };
    return { key: slug, label: titleCase(w.approvedFormationTopic.replace(/-/g, " ")) };
  })();

  // ---- PRIMARY FOCUS — the ranking cascade (deterministic) ----
  let focus: BriefingItem | null = null;

  if (w.focus) {
    // 1. Explicit Workspace focus always wins.
    const evidence: Evidence[] = [ev("workspace-focus", "Selected in Workspace", false)];
    const m = w.activeManuscript;
    if (m?.title) {
      const round = m.round ?? w.reviewRound;
      evidence.push(ev("manuscript", "Active manuscript", false, round != null ? `${m.title} · Round ${round}` : m.title));
      used.add(slugify(m.id ?? m.title));
    }
    focus = { text: w.focus, href: w.activeManuscript ? "/iteration" : undefined, evidence };
  } else if (w.activeManuscript?.title) {
    // 2. Active manuscript. If the board still owes a ruling on it, point to
    // Iteration (the decision lives there); otherwise frame it as needing a read.
    const m = w.activeManuscript;
    const round = m.round ?? w.reviewRound;
    used.add(slugify(m.id ?? m.title!));
    const manuscriptEv = ev("manuscript", "Active manuscript", false, round != null ? `${m.title} · Round ${round}` : m.title!);
    if (pendingJudgment) {
      focus = {
        text: `Continue ${m.title}.`,
        href: "/iteration",
        evidence: [manuscriptEv, ev("board", "Unresolved judgment on the Editorial Board", true)],
      };
    } else {
      focus = {
        text:
          round != null
            ? `${m.title} is the piece in motion — round ${round}, needing a read before it travels.`
            : `${m.title} is the piece in motion, needing a read before it travels.`,
        href: "/iteration",
        evidence: [manuscriptEv],
      };
    }
  } else if (approved) {
    // 3. Approved Formation topic.
    used.add(approved.key);
    const evidence: Evidence[] = [ev("formation-approved", "Approved in Workspace", false)];
    if (approved.references != null) evidence.push(formationStatus(approved.references));
    else if (approved.backlinks != null) evidence.push(ev("backlinks", "In the vault", true, plural(approved.backlinks, "backlink")));
    focus = { text: `${approved.label} is the topic you have promoted — it is forming.`, href: "/formation", evidence };
  } else if (hasVault && emerging.length) {
    // 4. Strongest emerging concept.
    const e = emerging[0];
    used.add(slugify(e.term));
    focus = {
      text: `${titleCase(e.term)} is gathering — the strongest thread forming in the Field.`,
      href: "/formation",
      evidence: [formationStatus(e.references)],
    };
  } else if (hasVault && concepts.length) {
    // 5. Structurally active concept, by backlinks.
    const c = concepts[0];
    used.add(c.id);
    focus = {
      text: `${c.title} is the most connected idea in the vault right now.`,
      href: "/field",
      evidence: [ev("backlinks", "Most connected in the vault", true, plural(c.backlinks, "backlink"))],
    };
  } else {
    // 6. Curated fallback — coherent, honestly labeled.
    const idea = IDEAS.find((i) => i.presentIn.includes("today")) ?? IDEAS[0];
    if (idea) {
      used.add(idea.id);
      focus = { text: `${idea.title} — ${idea.thesis}`, href: "/iteration", evidence: [ev("curated", "From curated content", true)] };
    }
  }

  // ---- ONE FIELD MOVEMENT / EMERGING CONCEPT (distinct from focus) ----
  let movement: BriefingItem | null = null;
  if (approved && !used.has(approved.key)) {
    used.add(approved.key);
    const evidence: Evidence[] = [ev("formation-approved", "Approved in Workspace", false)];
    if (approved.references != null) evidence.push(formationStatus(approved.references));
    movement = { text: `${approved.label} is the topic you have promoted — it is forming.`, href: "/formation", evidence };
  } else if (hasVault) {
    const e = emerging.find((x) => !used.has(slugify(x.term)));
    if (e) {
      used.add(slugify(e.term));
      movement = { text: `${titleCase(e.term)} is gathering references in the Field.`, href: "/formation", evidence: [formationStatus(e.references)] };
    } else {
      const c = concepts.find((x) => !used.has(x.id));
      if (c)
        movement = {
          text: `${c.title} is holding the most connections in the vault.`,
          href: "/field",
          evidence: [ev("backlinks", "In the vault", true, plural(c.backlinks, "backlink"))],
        };
    }
  }
  if (!movement && SIGNALS.length) {
    const s = SIGNALS[0];
    movement = { text: s.note, href: "/field", evidence: [ev("curated", "A signal in the Field", true)] };
  }

  // ---- ONE OPEN QUESTION ----
  let openQuestion: BriefingItem | null = null;
  if (w.openQuestions.length) {
    openQuestion = { text: w.openQuestions[0], href: "/formation", evidence: [ev("question-source", "Held in Workspace", false)] };
  } else {
    const q = QUESTIONS.find((x) => x.presentIn.includes("today")) ?? QUESTIONS[0];
    if (q) openQuestion = { text: q.text, href: "/formation", evidence: [ev("question-source", "Open in Formation", true)] };
  }

  // ---- ONE NEXT ACTION (only when authored or trivially derivable — never invented) ----
  let action: BriefingItem | null = null;
  if (w.nextAction) {
    action = { text: w.nextAction, href: w.activeManuscript ? "/iteration" : undefined, evidence: [ev("workspace-action", "Authored in Workspace", false)] };
  } else if (pendingJudgment) {
    // Point to where the judgment is made — never restate the decision here.
    action = {
      text: "Return to Iteration and resolve the outstanding ruling.",
      href: "/iteration",
      evidence: [ev("board", "Unresolved judgment on the Editorial Board", true)],
    };
  } else if (w.activeManuscript?.title) {
    const round = w.activeManuscript.round ?? w.reviewRound;
    action = {
      text: `Open ${w.activeManuscript.title} and give ${round != null ? `round ${round}` : "it"} a read.`,
      href: "/iteration",
      evidence: [ev("manuscript", "Active manuscript", false, round != null ? `Round ${round}` : undefined)],
    };
  }

  // ---- OPTIONAL SHORT NOTE FROM THE WORKSPACE ----
  const note: BriefingItem | null = w.todayNote
    ? { text: w.todayNote, evidence: [ev("workspace-note", "A note to yourself", false)] }
    : null;

  // Report the Workspace as a real source only when a present file actually parsed
  // into usable content — a present-but-malformed file must not claim authorship.
  const workspaceHasContent = Boolean(
    w.focus || w.activeManuscript || w.approvedFormationTopic || w.openQuestions.length || w.nextAction || w.todayNote || w.status || w.updatedAt,
  );
  const workspaceState = workspaceSource(wRes) === "file" && workspaceHasContent ? "file" : "default";

  return {
    question: TODAY_QUESTION,
    focus,
    movement,
    openQuestion,
    action,
    note,
    sources: { workspace: workspaceState, projection: projectionSource(projection), board: pendingJudgment ? "editorial-board" : "none" },
    provenance: {
      projection: { source: projection.source, lastSuccessfulSync: projection.lastSuccessfulSync, stale: projection.stale },
      board: { source: boardRes.source, lastSuccessfulSync: boardRes.lastSuccessfulSync, stale: boardRes.stale },
    },
    updated: workspaceState === "file" && w.updatedAt ? { at: w.updatedAt, by: w.updatedBy } : null,
  };
}
