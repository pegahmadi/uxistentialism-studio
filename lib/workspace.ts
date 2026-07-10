// Reads the Studio Workspace (data/studio/workspace.json): the user's active
// thinking context across the six environments. This is Studio-LOCAL state — it
// is NOT a mirror of Obsidian, is never written back to the vault, and holds only
// deliberate operational pointers (never manuscript bodies, vault content, absolute
// paths, or secrets).
//
// Server-only (uses fs). Every field is optional except schemaVersion; the reader
// degrades gracefully when the file is absent, partial, or malformed — it never
// throws, always returning a fully-shaped Workspace so callers need no guards.

import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_SCHEMA_VERSION = 1;

export type WorkspaceUpdatedBy = "human" | "claude";
export type WorkspaceStatus = "active" | "paused" | "resting";

export interface ActiveManuscript {
  id: string | null;
  title: string | null;
  round: number | null;
  venue: string | null;
}

export interface PausedItem {
  id: string | null;
  note: string | null;
}

export interface Workspace {
  schemaVersion: number;
  status: WorkspaceStatus | null;
  focus: string | null;
  activeManuscript: ActiveManuscript | null;
  reviewRound: number | null;
  approvedFormationTopic: string | null;
  openQuestions: string[];
  paused: PausedItem[];
  todayNote: string | null;
  nextAction: string | null;
  updatedAt: string | null;
  updatedBy: WorkspaceUpdatedBy | null;
}

// The safe, fully-shaped default returned whenever the file is missing or unusable.
function emptyWorkspace(): Workspace {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    status: null,
    focus: null,
    activeManuscript: null,
    reviewRound: null,
    approvedFormationTopic: null,
    openQuestions: [],
    paused: [],
    todayNote: null,
    nextAction: null,
    updatedAt: null,
    updatedBy: null,
  };
}

// ---- field coercers: tolerate anything, only accept well-typed values ----

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

function manuscript(v: unknown): ActiveManuscript | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const m: ActiveManuscript = {
    id: str(o.id),
    title: str(o.title),
    round: num(o.round),
    venue: str(o.venue),
  };
  // Only surface a manuscript if it carries at least an id or a title.
  return m.id || m.title ? m : null;
}

function pausedItems(v: unknown): PausedItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((entry): PausedItem | null => {
      if (!entry || typeof entry !== "object") return null;
      const o = entry as Record<string, unknown>;
      const item: PausedItem = { id: str(o.id), note: str(o.note) };
      return item.id || item.note ? item : null;
    })
    .filter((x): x is PausedItem => x !== null);
}

function workspacePath(): string {
  return path.join(process.cwd(), "data", "studio", "workspace.json");
}

/** Read + normalize the workspace. Never throws; falls back to a safe default. */
export function getWorkspace(): Workspace {
  let raw: unknown;
  try {
    const p = workspacePath();
    if (!fs.existsSync(p)) return emptyWorkspace();
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return emptyWorkspace();
  }
  if (!raw || typeof raw !== "object") return emptyWorkspace();
  const o = raw as Record<string, unknown>;

  return {
    schemaVersion: num(o.schemaVersion) ?? WORKSPACE_SCHEMA_VERSION,
    status: oneOf<WorkspaceStatus>(o.status, ["active", "paused", "resting"]),
    focus: str(o.focus),
    activeManuscript: manuscript(o.activeManuscript),
    reviewRound: num(o.reviewRound),
    approvedFormationTopic: str(o.approvedFormationTopic),
    openQuestions: strArray(o.openQuestions),
    paused: pausedItems(o.paused),
    todayNote: str(o.todayNote),
    nextAction: str(o.nextAction),
    updatedAt: str(o.updatedAt),
    updatedBy: oneOf<WorkspaceUpdatedBy>(o.updatedBy, ["human", "claude"]),
  };
}

/** Whether a real workspace file is present (vs. the built-in empty default). */
export function workspaceSource(): "file" | "default" {
  try {
    return fs.existsSync(workspacePath()) ? "file" : "default";
  } catch {
    return "default";
  }
}
