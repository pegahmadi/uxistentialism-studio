/*
 * Companion-side validation (WS-2).
 *
 * Obsidian projections: validated IN MEMORY through the shared
 * tools/validate-projection.mjs bridge (contract v1.1.1 — no temp files),
 * plus the §2a constraints the fixture validator does not cover
 * (non-empty concepts, 500-char summary cap).
 *
 * Editorial Board data: an in-module mirror of contract §2b, including the
 * v1 authority rules (non-empty `rulings` rejected; `manuscript.status`
 * "complete" rejected), exact-field/unknown-field enforcement, max lengths,
 * exact toISOString timestamps, and the shared §5 public-safety content scan.
 *
 * Inbox artifacts: exactly { sourceUpdatedAt, data } — any other top-level
 * key, or a missing/malformed sourceUpdatedAt, is a violation (the companion
 * never substitutes file mtime).
 *
 * Violation messages are REDACTED: they name fields and categories, never
 * offending values.
 */

import { validateProjection } from "../tools/validate-projection.mjs";
import { scanPublicSafety } from "../tools/public-safety.mjs";

export const ISO_EXACT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------- Obsidian

/**
 * @param {object} opts
 * @param {object} opts.data           projection `data` (in memory — no file I/O)
 * @param {string} [opts.vaultPath]    treated as a forbidden substring
 * @param {string} [opts.allowlistPath] test override
 * @returns {Promise<{ ok: boolean, violations: string[] }>}
 */
export async function validateObsidianData({ data, vaultPath, allowlistPath }) {
  const { violations } = await validateProjection({
    projection: data,
    vaultPath,
    ...(allowlistPath ? { allowlistPath } : {}),
  });
  const all = [...violations];

  // §2a constraints beyond the shared fixture validator.
  if (!Array.isArray(data?.concepts) || data.concepts.length === 0) {
    all.push("concepts must contain at least one entry (§2a)");
  } else {
    data.concepts.forEach((c, i) => {
      if (typeof c?.summary === "string" && c.summary.length > 500) {
        all.push(`concepts[${i}].summary exceeds 500 characters (§2a)`);
      }
    });
  }

  return { ok: all.length === 0, violations: all };
}

// ---------------------------------------------------- Editorial Board (§2b)

const DATA_FIELDS = [
  "manuscript",
  "reviewedAt",
  "reviewers",
  "unresolvedQuestions",
  "rulings",
  "nextDecision",
  "sourceLabel",
  "updatedAt",
  "updatedBy",
];
const MANUSCRIPT_FIELDS = ["id", "title", "reviewRound", "status"];
const REVIEWER_FIELDS = ["role", "diagnosis", "recommendation", "confidence"];
const MANUSCRIPT_STATUSES = new Set(["in review", "awaiting ruling", "complete"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const UPDATED_BY = new Set(["claude", "human"]);

function checkExactFields(obj, allowed, where, add) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) add(`${where}: unknown field "${k}" (§2b rejects unknown fields)`);
  }
  for (const k of allowed) {
    if (!(k in obj)) add(`${where}: missing required field "${k}"`);
  }
}

function checkString(obj, key, where, add, { max } = {}) {
  const v = obj[key];
  if (typeof v !== "string") {
    if (key in obj) add(`${where}.${key} must be a string`);
    return;
  }
  if (max !== undefined && v.length > max) {
    add(`${where}.${key} exceeds ${max} characters (§2b)`);
  }
}

function checkExactIso(obj, key, where, add) {
  const v = obj[key];
  if (key in obj && (typeof v !== "string" || !ISO_EXACT.test(v))) {
    add(`${where}.${key} must be exact Date.toISOString() format (§1)`);
  }
}

/**
 * Local mirror of contract §2b (server enforces all of this independently).
 * @param {unknown} data
 * @returns {string[]} violations (empty = valid)
 */
export function validateEditorialBoardData(data) {
  const violations = [];
  const add = (m) => violations.push(m);

  if (!isPlainObject(data)) return ["editorial-board data must be a JSON object"];

  checkExactFields(data, DATA_FIELDS, "data", add);

  // manuscript
  if (isPlainObject(data.manuscript)) {
    const m = data.manuscript;
    checkExactFields(m, MANUSCRIPT_FIELDS, "data.manuscript", add);
    checkString(m, "id", "data.manuscript", add);
    checkString(m, "title", "data.manuscript", add);
    if ("reviewRound" in m && (typeof m.reviewRound !== "number" || !Number.isFinite(m.reviewRound))) {
      add("data.manuscript.reviewRound must be a number");
    }
    if ("status" in m) {
      if (typeof m.status !== "string" || !MANUSCRIPT_STATUSES.has(m.status)) {
        add('data.manuscript.status must be "in review" | "awaiting ruling" | "complete"');
      } else if (m.status === "complete") {
        add('data.manuscript.status "complete" is rejected on live submissions — completion is human-attested state (§2b v1 status rule)');
      }
    }
  } else if ("manuscript" in data) {
    add("data.manuscript must be an object");
  }

  checkExactIso(data, "reviewedAt", "data", add);
  checkExactIso(data, "updatedAt", "data", add);

  // reviewers
  if (Array.isArray(data.reviewers)) {
    if (data.reviewers.length === 0) add("data.reviewers must contain at least one entry (§2b)");
    data.reviewers.forEach((r, i) => {
      const where = `data.reviewers[${i}]`;
      if (!isPlainObject(r)) {
        add(`${where} must be an object`);
        return;
      }
      checkExactFields(r, REVIEWER_FIELDS, where, add);
      checkString(r, "role", where, add);
      checkString(r, "diagnosis", where, add, { max: 500 });
      checkString(r, "recommendation", where, add, { max: 500 });
      if ("confidence" in r && !CONFIDENCE.has(r.confidence)) {
        add(`${where}.confidence must be "high" | "medium" | "low"`);
      }
    });
  } else if ("reviewers" in data) {
    add("data.reviewers must be an array");
  }

  // unresolvedQuestions
  if (Array.isArray(data.unresolvedQuestions)) {
    data.unresolvedQuestions.forEach((q, i) => {
      if (typeof q !== "string") add(`data.unresolvedQuestions[${i}] must be a string`);
      else if (q.length > 300) add(`data.unresolvedQuestions[${i}] exceeds 300 characters (§2b)`);
    });
  } else if ("unresolvedQuestions" in data) {
    add("data.unresolvedQuestions must be an array");
  }

  // rulings — v1 authority boundary: must be EMPTY on every live submission.
  if (Array.isArray(data.rulings)) {
    if (data.rulings.length > 0) {
      add("data.rulings must be empty on live submissions — human authorship is established by the write path, not payload content (§2b v1 rulings rule)");
    }
  } else if ("rulings" in data) {
    add("data.rulings must be an array");
  }

  checkString(data, "nextDecision", "data", add, { max: 300 });
  checkString(data, "sourceLabel", "data", add);
  if ("updatedBy" in data && !UPDATED_BY.has(data.updatedBy)) {
    add('data.updatedBy must be "claude" | "human"');
  }

  // Shared §5 public-safety content scan (redacted messages by construction).
  violations.push(...scanPublicSafety(data));

  return violations;
}

// ------------------------------------------------------ Inbox artifact (§2b)

/**
 * Wire format: exactly { sourceUpdatedAt, data }. Never substitute mtime.
 * @param {unknown} artifact
 * @returns {string[]} violations (empty = valid)
 */
export function validateInboxArtifact(artifact) {
  if (!isPlainObject(artifact)) return ["inbox artifact must be a JSON object"];

  const violations = [];
  for (const k of Object.keys(artifact)) {
    if (k !== "sourceUpdatedAt" && k !== "data") {
      violations.push(`inbox artifact: unknown top-level key "${k}" (must be exactly sourceUpdatedAt + data)`);
    }
  }
  if (typeof artifact.sourceUpdatedAt !== "string" || !ISO_EXACT.test(artifact.sourceUpdatedAt)) {
    violations.push("inbox artifact: sourceUpdatedAt missing or not exact Date.toISOString() format (mtime is never substituted)");
  }
  if (!("data" in artifact)) {
    violations.push("inbox artifact: missing data");
  } else {
    violations.push(...validateEditorialBoardData(artifact.data));
  }
  return violations;
}
