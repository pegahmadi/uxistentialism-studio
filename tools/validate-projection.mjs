#!/usr/bin/env node
/*
 * Public-safety validator for the Obsidian projection (data/projections/obsidian.json).
 *
 * The projection is committed to a PUBLIC repo, so this is the last gate before it
 * ships. It asserts the projection carries ONLY allowlisted, metadata-only, public-safe
 * content — no note bodies, no vault paths, no fields beyond the declared whitelist.
 *
 * Reusable as a library (`validateProjection(...)`) and runnable standalone:
 *   node tools/validate-projection.mjs
 * Exits non-zero on any violation.
 *
 * Callers may validate an in-memory object instead of a file by passing
 * `projection` (contract v1.1.1 — lets the companion validate without writing
 * any projection file). The content scan uses the shared public-safety
 * primitive (tools/public-safety.mjs) so this validator, the companion, and
 * the ingestion endpoints cannot drift.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanPublicSafety } from "./public-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const TOP_FIELDS = new Set(["generatedAt", "source", "concepts", "connections", "emerging"]);
const CONCEPT_FIELDS = new Set(["id", "title", "kind", "category", "summary", "presentIn", "backlinks"]);
const CONNECTION_FIELDS = new Set(["from", "to"]);
const EMERGING_FIELDS = new Set(["term", "references"]);

function extraKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.has(k));
}

/**
 * Validate a projection against its allowlist.
 * @param {object} [opts]
 * @param {object} [opts.projection]     in-memory projection object; when present, no file is read
 * @param {string} [opts.projectionPath] path to a projection JSON file (default: committed fixture)
 * @param {string} [opts.allowlistPath]  path to the allowlist (default: integrations/obsidian/allowlist.json)
 * @param {string} [opts.vaultPath]      local vault path; treated as a forbidden substring
 * @returns {{ ok: boolean, violations: string[], stats: object }}
 */
export async function validateProjection({ projection, projectionPath, allowlistPath, vaultPath } = {}) {
  const allowPath =
    allowlistPath || path.join(REPO_ROOT, "integrations", "obsidian", "allowlist.json");

  const violations = [];
  const add = (m) => violations.push(m);

  let proj = projection;
  if (proj === undefined) {
    const projPath = projectionPath || path.join(REPO_ROOT, "data", "projections", "obsidian.json");
    if (!existsSync(projPath)) {
      return { ok: false, violations: [`projection not found: ${projPath}`], stats: {} };
    }
    try {
      proj = JSON.parse(await readFile(projPath, "utf8"));
    } catch (e) {
      return { ok: false, violations: [`projection is not valid JSON: ${e.message}`], stats: {} };
    }
  }
  if (!proj || typeof proj !== "object") {
    return { ok: false, violations: ["projection is not an object"], stats: {} };
  }

  if (!existsSync(allowPath)) {
    return { ok: false, violations: [`allowlist not found: ${allowPath}`], stats: {} };
  }
  let allow;
  try {
    allow = JSON.parse(await readFile(allowPath, "utf8"));
  } catch (e) {
    return { ok: false, violations: [`allowlist is not valid JSON: ${e.message}`], stats: {} };
  }

  const allowedIds = new Set((allow.concepts || []).map((c) => c.id));
  const allowedEmerging = new Set((allow.emerging || []).map((t) => String(t).toLowerCase()));

  // Top-level shape.
  for (const k of extraKeys(proj, TOP_FIELDS)) add(`unexpected top-level field "${k}"`);
  if (typeof proj.generatedAt !== "string" || Number.isNaN(Date.parse(proj.generatedAt))) {
    add("generatedAt is missing or not an ISO timestamp");
  }

  // Concepts.
  const concepts = Array.isArray(proj.concepts) ? proj.concepts : [];
  if (!Array.isArray(proj.concepts)) add("concepts is missing or not an array");
  for (const c of concepts) {
    const where = `concept "${c?.id ?? "?"}"`;
    for (const k of extraKeys(c, CONCEPT_FIELDS)) add(`${where}: unexpected field "${k}"`);
    if (!allowedIds.has(c.id)) add(`${where}: id not in allowlist`);
    if (typeof c.title !== "string") add(`${where}: title must be a string`);
    if (typeof c.summary !== "string") add(`${where}: summary must be a string`);
    if (!Array.isArray(c.presentIn)) add(`${where}: presentIn must be an array`);
    if (typeof c.backlinks !== "number") add(`${where}: backlinks must be a number`);
  }

  // Connections — both endpoints allowlisted.
  const connections = Array.isArray(proj.connections) ? proj.connections : [];
  if (!Array.isArray(proj.connections)) add("connections is missing or not an array");
  for (const e of connections) {
    const where = `connection ${e?.from ?? "?"}→${e?.to ?? "?"}`;
    for (const k of extraKeys(e, CONNECTION_FIELDS)) add(`${where}: unexpected field "${k}"`);
    if (!allowedIds.has(e.from)) add(`${where}: "from" endpoint not in allowlist`);
    if (!allowedIds.has(e.to)) add(`${where}: "to" endpoint not in allowlist`);
  }

  // Emerging — term must be allowlisted, references numeric.
  const emerging = Array.isArray(proj.emerging) ? proj.emerging : [];
  if (!Array.isArray(proj.emerging)) add("emerging is missing or not an array");
  for (const em of emerging) {
    const where = `emerging "${em?.term ?? "?"}"`;
    for (const k of extraKeys(em, EMERGING_FIELDS)) add(`${where}: unexpected field "${k}"`);
    if (!allowedEmerging.has(String(em.term).toLowerCase())) add(`${where}: term not in allowlist`);
    if (typeof em.references !== "number") add(`${where}: references must be a number`);
  }

  // Deep scan for leaked keys / paths anywhere — shared §5 primitive.
  violations.push(...scanPublicSafety(proj, { extraNeedles: vaultPath ? [vaultPath] : [] }));

  return {
    ok: violations.length === 0,
    violations,
    stats: { concepts: concepts.length, connections: connections.length, emerging: emerging.length },
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const { ok, violations, stats } = await validateProjection();
  if (ok) {
    console.log(
      `✓ Projection is public-safe — ${stats.concepts} concepts, ${stats.connections} connections, ${stats.emerging} emerging. No bodies, paths, or extra fields.`,
    );
    process.exit(0);
  }
  console.error(`\n✖ Projection failed validation (${violations.length}):`);
  for (const v of violations) console.error(`  · ${v}`);
  console.error("");
  process.exit(1);
}
