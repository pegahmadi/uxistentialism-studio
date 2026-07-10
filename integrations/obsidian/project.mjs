#!/usr/bin/env node
/*
 * Obsidian → Studio projection generator (read-only source connector).
 *
 * Reads the live vault READ-ONLY (via the audit tool's shared layer) and emits a
 * SANITIZED, METADATA-ONLY projection the app can safely read: only items in
 * integrations/obsidian/allowlist.json, only the fields declared there, plus the
 * vault's real link structure (connections) and emerging-concept reference counts.
 *
 * It NEVER emits note bodies, private notes, or the vault path. The output is
 * committed to a public repo, so the allowlist is the privacy gate.
 *
 * Usage: node integrations/obsidian/project.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadNotes, computeGraph, fail } from "../../tools/vault-audit/_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ALLOWLIST = path.join(__dirname, "allowlist.json");
const OUT = path.join(REPO_ROOT, "data", "projections", "obsidian.json");

async function main() {
  const allow = JSON.parse(await readFile(ALLOWLIST, "utf8"));
  const { notes } = await loadNotes(); // read-only; the vault is never written
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

  const projection = {
    generatedAt: new Date().toISOString(),
    source: "obsidian-vault (sanitized · metadata-only · no bodies)",
    concepts,
    connections,
    emerging,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(projection, null, 2) + "\n");

  console.log("\n✓ Projection generated. The vault was read-only and not modified.");
  console.log(`  Concepts projected:  ${concepts.length} of ${allow.concepts.length} allowlisted`);
  console.log(`  Connections:         ${connections.length} (allowlisted ↔ allowlisted only)`);
  console.log(`  Emerging concepts:   ${emerging.length}`);
  if (missing.length) console.log(`  ⚠ Not found in vault (skipped): ${missing.join(", ")}`);
  console.log(`  No note bodies, private notes, or vault path were written.`);
  console.log(`  Output: data/projections/obsidian.json`);
}

main().catch((e) => fail(e.stack || String(e)));
