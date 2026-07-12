#!/usr/bin/env node
/*
 * Tests for the reusable Obsidian projector (coordinator-owned shared infra).
 *
 * PORTABLE: the primary suite builds a synthetic temporary vault (outside the
 * repo) and needs no local configuration. If a real vault is configured
 * (VAULT_PATH or the gitignored audit config), an optional integration section
 * runs against it as well.
 *
 * Covers the contract WS-2 depends on:
 *   - exact return shape ({ data: 4 fields, sourceUpdatedAt, missing })
 *   - purity: no fixture writes
 *   - sourceUpdatedAt = newest mtime among ALL scanned notes
 *   - zero-note rejection (throws, never exits)
 *   - missing allowlisted notes reported
 *   - skipFolders is additive: custom exclusions never remove safety defaults
 *
 * Usage: node tools/tests/projector.test.mjs
 */

import { mkdtemp, mkdir, writeFile, utimes, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
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

// ---------- synthetic vault fixture ----------

async function makeSyntheticVault() {
  const root = await mkdtemp(path.join(tmpdir(), "synth-vault-"));
  const at = async (rel, content, mtimeSec) => {
    const p = path.join(root, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content);
    await utimes(p, mtimeSec, mtimeSec); // (atime, mtime)
  };
  // Allowlisted notes. beta links to alpha (backlink); alpha references the
  // emerging term. mtimes are deliberately staggered (seconds since epoch).
  await at("alpha.md", "# Alpha\nLinks to [[gamma missing]] and [[beta]].", 1_000_000);
  await at("beta.md", "# Beta\nSee [[alpha]].", 2_000_000);
  // Non-allowlisted note: newest REGULAR mtime + adds a backlink to alpha.
  await at("private/note.md", "Private thoughts about [[alpha]].", 3_000_000);
  // Notes that must be EXCLUDED by skip rules; give them the newest mtimes so
  // leakage would corrupt sourceUpdatedAt visibly.
  await at("Templates/tpl.md", "Template [[alpha]] [[gamma missing]]", 4_000_000);
  await at("customskip/x.md", "Skip me [[alpha]] [[gamma missing]]", 5_000_000);

  const allowlistPath = path.join(root, "..", `synth-allow-${path.basename(root)}.json`);
  await writeFile(allowlistPath, JSON.stringify({
    concepts: [
      { vaultKey: "alpha", id: "alpha", title: "Alpha", kind: "core", category: "test", summary: "Alpha concept.", presentIn: ["today"] },
      { vaultKey: "beta", id: "beta", title: "Beta", kind: "concept", category: "test", summary: "Beta concept.", presentIn: ["field"] },
      { vaultKey: "ghost", id: "ghost", title: "Ghost", kind: "concept", category: "test", summary: "Not in the vault.", presentIn: ["memory"] },
    ],
    emerging: ["gamma missing"],
  }));
  return { root, allowlistPath };
}

const fixtureSig = () => stat(FIXTURE).then((s) => `${s.size}:${s.mtimeMs}`).catch(() => "absent");

// ---------- 1. library errors throw, never exit ----------

console.log("Library error behavior:");
try { resolveVaultPath(null); check("resolveVaultPath(null) throws", false); }
catch (e) { check("resolveVaultPath(null) throws VaultError", e instanceof VaultError && e.code === "NO_VAULT_PATH"); }
try { await loadNotesFrom({ vaultPath: "/nonexistent/vault/path" }); check("loadNotesFrom(bad path) throws", false); }
catch (e) { check("loadNotesFrom(bad path) throws VaultError", e instanceof VaultError && e.code === "VAULT_NOT_FOUND"); }
try { await project({}); check("project() without vaultPath throws", false); }
catch (e) { check("project() without vaultPath throws (no exit)", e instanceof Error); }

// ---------- 2. synthetic vault: shape, purity, counts, mtimes, skips ----------

console.log("Synthetic vault:");
const { root, allowlistPath } = await makeSyntheticVault();
try {
  const before = await fixtureSig();
  const r = await project({ vaultPath: root, allowlistPath, skipFolders: ["customskip"] });
  const after = await fixtureSig();

  check("fixture untouched by project()", before === after, { before, after });
  check("returns data + sourceUpdatedAt + missing", "data" in r && "sourceUpdatedAt" in r && "missing" in r);
  const keys = Object.keys(r.data).sort();
  check("data has exactly the four contract fields", JSON.stringify(keys) === JSON.stringify(["concepts", "connections", "emerging", "generatedAt"]), keys);
  check("no source field inside data", !("source" in r.data));
  check("timestamps in exact toISOString format", ISO_EXACT.test(r.sourceUpdatedAt) && ISO_EXACT.test(r.data.generatedAt));

  check("missing reports absent allowlisted note", JSON.stringify(r.missing) === JSON.stringify(["ghost"]), r.missing);
  check("projects only found allowlisted concepts", r.data.concepts.map((c) => c.id).sort().join(",") === "alpha,beta");

  const alpha = r.data.concepts.find((c) => c.id === "alpha");
  // backlinks to alpha: beta.md + private/note.md = 2. Templates/ and customskip/
  // both excluded — if either leaked, backlinks would be 3–4.
  check("backlinks count includes non-allowlisted notes, excludes skipped", alpha?.backlinks === 2, alpha?.backlinks);
  check("connections only allowlisted↔allowlisted", JSON.stringify(r.data.connections) === JSON.stringify([{ from: "alpha", to: "beta" }]), r.data.connections);

  const gamma = r.data.emerging.find((e) => e.term === "gamma missing");
  // references to the unresolved term: alpha.md only (skipped folders excluded).
  check("emerging references exclude skipped folders", gamma?.references === 1, gamma?.references);

  // sourceUpdatedAt = newest mtime among SCANNED notes = private/note.md (3M sec);
  // Templates (4M) and customskip (5M) are excluded, so any leak is visible.
  check("sourceUpdatedAt = newest scanned mtime (non-allowlisted included, skipped excluded)",
    r.sourceUpdatedAt === new Date(3_000_000 * 1000).toISOString(), r.sourceUpdatedAt);

  // skip merge at the loader level: custom exclusions must not remove defaults.
  const { notes } = await loadNotesFrom({ vaultPath: root, skipFolders: ["customskip"] });
  const rels = notes.map((n) => n.relPath).sort();
  check("custom skipFolders excludes the custom folder", !rels.some((p) => p.startsWith("customskip")), rels);
  check("default skips (Templates) preserved alongside custom", !rels.some((p) => p.startsWith("Templates")), rels);
  check("regular + non-allowlisted notes still scanned", rels.length === 3, rels);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(allowlistPath, { force: true });
}

// ---------- 3. zero-note rejection ----------

console.log("Zero-note vault:");
const emptyRoot = await mkdtemp(path.join(tmpdir(), "synth-empty-"));
const emptyAllow = path.join(emptyRoot, "..", `synth-allow-${path.basename(emptyRoot)}.json`);
await writeFile(emptyAllow, JSON.stringify({ concepts: [], emerging: [] }));
try { await project({ vaultPath: emptyRoot, allowlistPath: emptyAllow }); check("empty vault rejected", false); }
catch (e) { check("empty vault throws VAULT_EMPTY (no exit)", e instanceof VaultError && e.code === "VAULT_EMPTY"); }
finally {
  await rm(emptyRoot, { recursive: true, force: true });
  await rm(emptyAllow, { force: true });
}

// ---------- 4. OPTIONAL integration: real vault when configured ----------

const { vaultPath } = await loadConfig();
if (vaultPath) {
  console.log("Real vault (optional integration):");
  const before = await fixtureSig();
  const r = await project({ vaultPath });
  const after = await fixtureSig();
  check("fixture untouched", before === after);
  check("concepts non-empty", r.data.concepts.length > 0);
  check("sourceUpdatedAt exact format", ISO_EXACT.test(r.sourceUpdatedAt), r.sourceUpdatedAt);
  try {
    const fixture = JSON.parse(await readFile(FIXTURE, "utf8"));
    check("same concept ids as committed fixture",
      JSON.stringify(fixture.concepts.map((c) => c.id).sort()) === JSON.stringify(r.data.concepts.map((c) => c.id).sort()));
  } catch { console.log("  (fixture absent — skipping consistency check)"); }
} else {
  console.log("Real vault: not configured — integration section skipped (synthetic suite is authoritative).");
}

console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
