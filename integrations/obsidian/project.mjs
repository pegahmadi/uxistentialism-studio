#!/usr/bin/env node
/*
 * Obsidian → Studio projection (read-only source connector).
 *
 * Two calling conventions:
 *
 *   LIBRARY (companion-safe):
 *     import { project } from "./project.mjs"
 *     const { data, sourceUpdatedAt, missing } = await project({ vaultPath })
 *   Pure and read-only: reads the vault via the shared loader, THROWS on failure
 *   (never process.exit), writes nothing. `data` contains exactly the four
 *   contract fields ({ generatedAt, concepts, connections, emerging });
 *   `sourceUpdatedAt` is envelope material and is never placed inside `data`.
 *
 *   CLI (manual fallback-fixture refresh):
 *     node integrations/obsidian/project.mjs
 *   Reads the vault path from VAULT_PATH or the audit tool's gitignored config,
 *   and deliberately writes the committed fallback fixture
 *   data/projections/obsidian.json. This is the only mode that writes.
 *
 * It NEVER emits note bodies, private notes, or vault paths. The fixture is
 * committed to a public repo, so the allowlist is the privacy gate.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadNotesFrom, computeGraph, fail, VaultError } from "../../tools/vault-audit/_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ALLOWLIST = path.join(__dirname, "allowlist.json");
const OUT = path.join(REPO_ROOT, "data", "projections", "obsidian.json");

/**
 * Pure projection function (companion-safe). Read-only; throws on failure;
 * writes nothing.
 *
 * @param {object} opts
 * @param {string} opts.vaultPath      required — explicit vault root
 * @param {string} [opts.allowlistPath] defaults to integrations/obsidian/allowlist.json
 * @param {string[]} [opts.skipFolders] extra folders to skip while scanning
 * @returns {Promise<{
 *   data: { generatedAt: string, concepts: object[], connections: object[], emerging: object[] },
 *   sourceUpdatedAt: string,
 *   missing: string[]
 * }>}
 *
 * `sourceUpdatedAt` is the newest mtime among EVERY scanned (non-skipped) note —
 * not only allowlisted ones — because non-allowlisted notes contribute to
 * backlink and emerging reference counts. Only the single timestamp is exposed;
 * no note identities, paths, or individual mtimes leave this function.
 */
export async function project({ vaultPath, allowlistPath = ALLOWLIST, skipFolders } = {}) {
  const allow = JSON.parse(await readFile(allowlistPath, "utf8"));
  const { notes } = await loadNotesFrom({ vaultPath, ...(skipFolders ? { skipFolders } : {}) }); // read-only; throws VaultError
  if (!notes.length) {
    throw new VaultError("Vault scan found zero notes — refusing to project an empty vault.", "VAULT_EMPTY");
  }
  const graph = computeGraph(notes);

  const byKey = new Map();
  for (const n of notes) if (!byKey.has(n.key)) byKey.set(n.key, n);

  const keyToId = new Map();
  const allowedKeys = new Set();
  for (const c of allow.concepts) {
    keyToId.set(c.vaultKey.toLowerCase(), c.id);
    allowedKeys.add(c.vaultKey.toLowerCase());
  }

  // Concepts — allowlisted metadata + the vault's real backlink count (a number).
  const concepts = [];
  const missing = [];
  for (const c of allow.concepts) {
    const note = byKey.get(c.vaultKey.toLowerCase());
    if (!note) {
      missing.push(c.vaultKey);
      continue;
    }
    concepts.push({
      id: c.id,
      title: c.title,
      kind: c.kind,
      category: c.category,
      summary: c.summary,
      presentIn: c.presentIn,
      backlinks: note.inboundCount,
    });
  }

  // Connections — real vault edges, but only where BOTH endpoints are allowlisted.
  const seen = new Set();
  const connections = [];
  for (const c of allow.concepts) {
    const note = byKey.get(c.vaultKey.toLowerCase());
    if (!note) continue;
    for (const target of note.outbound) {
      if (target === c.vaultKey.toLowerCase()) continue;
      if (!allowedKeys.has(target)) continue;
      const other = keyToId.get(target);
      const pair = [c.id, other].sort();
      const sig = pair.join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);
      connections.push({ from: pair[0], to: pair[1] });
    }
  }

  // Emerging — allowlisted terms + their real referenced-but-missing counts.
  const emerging = allow.emerging.map((term) => ({
    term,
    references: graph.unresolved.get(term.toLowerCase())?.count ?? 0,
  }));

  // Newest mtime across every scanned note (aggregate counts are vault-wide).
  const sourceUpdatedAt = new Date(Math.max(...notes.map((n) => n.mtimeMs))).toISOString();

  return {
    data: {
      generatedAt: new Date().toISOString(),
      concepts,
      connections,
      emerging,
    },
    sourceUpdatedAt,
    missing,
  };
}

// ---- CLI: deliberate manual refresh of the committed fallback fixture ----

async function main() {
  const { vaultPath } = await loadConfig();
  if (!vaultPath) fail("No vault path. Set VAULT_PATH or vaultPath in tools/vault-audit/audit.config.json");

  let result;
  try {
    result = await project({ vaultPath });
  } catch (e) {
    fail(e.message);
  }
  const { data, sourceUpdatedAt, missing } = result;

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 2) + "\n");

  console.log("\n✓ Projection generated. The vault was read-only and not modified.");
  console.log(`  Concepts projected:  ${data.concepts.length} of ${data.concepts.length + missing.length} allowlisted`);
  console.log(`  Connections:         ${data.connections.length} (allowlisted ↔ allowlisted only)`);
  console.log(`  Emerging concepts:   ${data.emerging.length}`);
  console.log(`  Source updated at:   ${sourceUpdatedAt}`);
  if (missing.length) console.log(`  ⚠ Not found in vault (skipped): ${missing.join(", ")}`);
  console.log(`  No note bodies, private notes, or vault path were written.`);
  console.log(`  Output: data/projections/obsidian.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => fail(e.stack || String(e)));
}
