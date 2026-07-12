#!/usr/bin/env node
/*
 * Tests for the reusable Obsidian projector (coordinator-owned shared infra).
 *
 * Verifies the contract WS-2 depends on:
 *   - project({ vaultPath }) is pure: returns { data, sourceUpdatedAt, missing },
 *     writes nothing, and `data` contains exactly the four contract fields.
 *   - Library errors THROW (VaultError) — they never process.exit().
 *   - sourceUpdatedAt uses the exact Date.toISOString() format.
 *
 * Requires a real vault: set VAULT_PATH, or have the gitignored
 * tools/vault-audit/audit.config.json present. Local-only test (not CI).
 *
 * Usage: node tools/tests/projector.test.mjs
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { project } from "../../integrations/obsidian/project.mjs";
import { loadConfig, loadNotesFrom, resolveVaultPath, VaultError, REPO_ROOT } from "../vault-audit/_shared.mjs";

const ISO_EXACT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIXTURE = path.join(REPO_ROOT, "data", "projections", "obsidian.json");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`); }
}

const { vaultPath } = await loadConfig();
if (!vaultPath) {
  console.error("✖ No vault path (set VAULT_PATH or audit.config.json). Skipping — this test requires a local vault.");
  process.exit(1);
}

// --- library errors throw, never exit ---
console.log("Library error behavior:");
try { resolveVaultPath(null); check("resolveVaultPath(null) throws", false); }
catch (e) { check("resolveVaultPath(null) throws VaultError", e instanceof VaultError && e.code === "NO_VAULT_PATH"); }
try { await loadNotesFrom({ vaultPath: "/nonexistent/vault/path" }); check("loadNotesFrom(bad path) throws", false); }
catch (e) { check("loadNotesFrom(bad path) throws VaultError", e instanceof VaultError && e.code === "VAULT_NOT_FOUND"); }
try { await project({}); check("project() without vaultPath throws", false); }
catch (e) { check("project() without vaultPath throws (no exit)", e instanceof Error); }

// --- purity: no writes ---
console.log("Purity:");
const before = await stat(FIXTURE).then((s) => `${s.size}:${s.mtimeMs}`).catch(() => "absent");
const result = await project({ vaultPath });
const after = await stat(FIXTURE).then((s) => `${s.size}:${s.mtimeMs}`).catch(() => "absent");
check("fixture untouched by project()", before === after, { before, after });

// --- return shape ---
console.log("Return shape:");
check("returns data + sourceUpdatedAt + missing", "data" in result && "sourceUpdatedAt" in result && "missing" in result);
const keys = Object.keys(result.data).sort();
check("data has exactly the four contract fields", JSON.stringify(keys) === JSON.stringify(["concepts", "connections", "emerging", "generatedAt"]), keys);
check("no source field inside data", !("source" in result.data));
check("sourceUpdatedAt is exact toISOString format", ISO_EXACT.test(result.sourceUpdatedAt), result.sourceUpdatedAt);
check("generatedAt is exact toISOString format", ISO_EXACT.test(result.data.generatedAt), result.data.generatedAt);
check("concepts non-empty", Array.isArray(result.data.concepts) && result.data.concepts.length > 0);
check("connections is array", Array.isArray(result.data.connections));
check("emerging is array", Array.isArray(result.data.emerging));
check("missing is array", Array.isArray(result.missing));

// --- data matches committed fixture's substantive content (same vault) ---
console.log("Consistency with committed fixture:");
try {
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8"));
  check("same concept ids as fixture",
    JSON.stringify(fixture.concepts.map((c) => c.id).sort()) === JSON.stringify(result.data.concepts.map((c) => c.id).sort()));
} catch {
  console.log("  (fixture absent — skipping consistency check)");
}

console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
