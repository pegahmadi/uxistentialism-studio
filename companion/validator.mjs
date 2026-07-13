/*
 * Companion-side validation (WS-2).
 *
 * Obsidian projections: validated IN MEMORY through two layers that BOTH run
 * on every sync (FIX 8):
 *   1. the shared tools/validate-projection.mjs bridge (contract v1.1.1 —
 *      no temp files) as the allowlist/public-safety layer, and
 *   2. a STRICT companion-side §2a schema mirror matching the server: exact
 *      field sets at every level (data.source and every unknown field
 *      rejected — the shared validator's legacy tolerance is not relied on),
 *      required fields/types, non-empty concepts, 500-char summary cap.
 *
 * Timestamps (FIX 9): every timestamp check is regex AND round-trip —
 * new Date(Date.parse(t)).toISOString() === t — so impossible dates
 * ("2026-02-31…") are rejected even though they match the format regex.
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

/**
 * FIX 9 — exact-format AND round-trip timestamp check. The regex alone admits
 * impossible dates ("2026-02-31T…"); the round-trip rejects them.
 */
export function isExactIsoTimestamp(v) {
  if (typeof v !== "string" || !ISO_EXACT.test(v)) return false;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).toISOString() === v;
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------- Obsidian

// FIX 8 — strict §2a field sets (server parity). Note: NO "source" at the top
// level — the shared fixture validator tolerates it for legacy fixtures; the
// live submission path must not.
const OBSIDIAN_DATA_FIELDS = ["generatedAt", "concepts", "connections", "emerging"];
const OBSIDIAN_CONCEPT_FIELDS = ["id", "title", "kind", "category", "summary", "presentIn", "backlinks"];
const OBSIDIAN_CONNECTION_FIELDS = ["from", "to"];
const OBSIDIAN_EMERGING_FIELDS = ["term", "references"];

function exactFields(obj, allowed, where, add) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) add(`${where}: unknown field "${k}" (§2a rejects unknown fields)`);
  }
  for (const k of allowed) {
    if (!(k in obj)) add(`${where}: missing required field "${k}" (§2a)`);
  }
}

/**
 * FIX 8 — strict companion-side §2a schema mirror (server parity). Runs in
 * ADDITION to the shared allowlist/public-safety validator; it never relies
 * on that validator's legacy tolerance for `source`.
 * @param {unknown} data
 * @returns {string[]} violations (empty = valid)
 */
export function validateObsidianDataStrict(data) {
  const violations = [];
  const add = (m) => violations.push(m);

  if (!isPlainObject(data)) return ["projection data must be a JSON object (§2a)"];

  exactFields(data, OBSIDIAN_DATA_FIELDS, "data", add);

  if ("generatedAt" in data && !isExactIsoTimestamp(data.generatedAt)) {
    add("data.generatedAt must be exact Date.toISOString() format and a real instant (§1/§2a)");
  }

  if (Array.isArray(data.concepts)) {
    if (data.concepts.length === 0) add("data.concepts must contain at least one entry (§2a)");
    data.concepts.forEach((c, i) => {
      const where = `data.concepts[${i}]`;
      if (!isPlainObject(c)) {
        add(`${where} must be an object`);
        return;
      }
      exactFields(c, OBSIDIAN_CONCEPT_FIELDS, where, add);
      for (const k of ["id", "title", "kind", "category", "summary"]) {
        if (k in c && typeof c[k] !== "string") add(`${where}.${k} must be a string`);
      }
      if (typeof c.summary === "string" && c.summary.length > 500) {
        add(`${where}.summary exceeds 500 characters (§2a)`);
      }
      if ("presentIn" in c) {
        if (!Array.isArray(c.presentIn)) add(`${where}.presentIn must be an array`);
        else if (c.presentIn.some((p) => typeof p !== "string")) {
          add(`${where}.presentIn entries must be strings`);
        }
      }
      if ("backlinks" in c && (typeof c.backlinks !== "number" || !Number.isFinite(c.backlinks))) {
        add(`${where}.backlinks must be a number`);
      }
    });
  } else if ("concepts" in data) {
    add("data.concepts must be an array");
  }

  if (Array.isArray(data.connections)) {
    data.connections.forEach((e, i) => {
      const where = `data.connections[${i}]`;
      if (!isPlainObject(e)) {
        add(`${where} must be an object`);
        return;
      }
      exactFields(e, OBSIDIAN_CONNECTION_FIELDS, where, add);
      for (const k of OBSIDIAN_CONNECTION_FIELDS) {
        if (k in e && typeof e[k] !== "string") add(`${where}.${k} must be a string`);
      }
    });
  } else if ("connections" in data) {
    add("data.connections must be an array");
  }

  if (Array.isArray(data.emerging)) {
    data.emerging.forEach((em, i) => {
      const where = `data.emerging[${i}]`;
      if (!isPlainObject(em)) {
        add(`${where} must be an object`);
        return;
      }
      exactFields(em, OBSIDIAN_EMERGING_FIELDS, where, add);
      if ("term" in em && typeof em.term !== "string") add(`${where}.term must be a string`);
      if ("references" in em && (typeof em.references !== "number" || !Number.isFinite(em.references))) {
        add(`${where}.references must be a number`);
      }
    });
  } else if ("emerging" in data) {
    add("data.emerging must be an array");
  }

  return violations;
}

/**
 * @param {object} opts
 * @param {object} opts.data           projection `data` (in memory — no file I/O)
 * @param {string} [opts.vaultPath]    treated as a forbidden substring
 * @param {string} [opts.allowlistPath] test override
 * @returns {Promise<{ ok: boolean, violations: string[] }>}
 */
export async function validateObsidianData({ data, vaultPath, allowlistPath }) {
  // Layer 1 — shared allowlist/public-safety validator (in memory).
  const { violations } = await validateProjection({
    projection: data,
    vaultPath,
    ...(allowlistPath ? { allowlistPath } : {}),
  });

  // Layer 2 (FIX 8) — strict §2a schema mirror; never relies on the shared
  // validator's legacy tolerance (e.g. it rejects data.source outright).
  const all = [...violations, ...validateObsidianDataStrict(data)];

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
  if (key in obj && !isExactIsoTimestamp(obj[key])) {
    add(`${where}.${key} must be exact Date.toISOString() format and a real instant (§1)`);
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
  if (!isExactIsoTimestamp(artifact.sourceUpdatedAt)) {
    violations.push("inbox artifact: sourceUpdatedAt missing, not exact Date.toISOString() format, or not a real instant (mtime is never substituted)");
  }
  if (!("data" in artifact)) {
    violations.push("inbox artifact: missing data");
  } else {
    violations.push(...validateEditorialBoardData(artifact.data));
  }
  return violations;
}
