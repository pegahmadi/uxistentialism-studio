#!/usr/bin/env node
/*
 * refresh-studio — one safe command to refresh the Studio from Obsidian.
 *
 * Pipeline (stops on first failure, NEVER touches git):
 *   1. Snapshot the vault (size + mtime of every file) — read-only.
 *   2. Regenerate the sanitized projection.
 *   3. Re-snapshot the vault and assert it is byte-for-byte untouched.
 *   4. Validate the projection is public-safe (allowlisted metadata only).
 *   5. Run lint and build.
 *   6. Summarize what changed in the projection.
 *   7. Stop — you review and commit yourself.
 *
 * No auto-commit, no watcher, no polling, no write-back. Usage:
 *   node tools/refresh-studio.mjs   (or: npm run refresh-studio)
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, assertReadableVault } from "./vault-audit/_shared.mjs";
import { validateProjection } from "./validate-projection.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PROJECTION = path.join(REPO_ROOT, "data", "projections", "obsidian.json");

// Dirs never worth snapshotting (heavy, or Obsidian's own churn).
const SNAP_SKIP = new Set([".git", ".obsidian", ".trash", ".stversions", "node_modules"]);

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
};

function die(msg) {
  console.error(`\n${c.red("✖")} ${msg}\n`);
  process.exit(1);
}

function step(n, label) {
  console.log(`\n${c.bold(`[${n}/6]`)} ${label}`);
}

// Read-only recursive fingerprint of the whole vault: path → "size:mtimeMs".
async function snapshotVault(root) {
  const snap = new Map();
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || SNAP_SKIP.has(e.name)) continue;
        await walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        const full = path.join(dir, e.name);
        try {
          const st = await stat(full);
          snap.set(path.relative(root, full), `${st.size}:${st.mtimeMs}`);
        } catch {
          /* file vanished mid-walk; ignore */
        }
      }
    }
  }
  await walk(root);
  return snap;
}

function diffSnapshots(before, after) {
  const changed = [];
  for (const [p, sig] of before) {
    if (!after.has(p)) changed.push(`removed: ${p}`);
    else if (after.get(p) !== sig) changed.push(`modified: ${p}`);
  }
  for (const p of after.keys()) if (!before.has(p)) changed.push(`created: ${p}`);
  return changed;
}

function run(cmd, args, label) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, stdio: "inherit" });
    child.on("close", (code) => {
      if (code !== 0) die(`${label} failed (exit ${code}).`);
      resolve();
    });
    child.on("error", (err) => die(`${label} could not start: ${err.message}`));
  });
}

async function readTextOrNull(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

function parseOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The substantive knowledge, ignoring generatedAt (a timestamp is not knowledge).
function substantiveKnowledge(proj) {
  if (!proj) return null;
  const rest = { ...proj };
  delete rest.generatedAt;
  return JSON.stringify(rest);
}

function summarizeProjectionDiff(before, after) {
  if (!before) {
    console.log(c.dim("  (no previous projection — this is the first generation)"));
    return;
  }
  const ids = (o) => new Set((o?.concepts ?? []).map((x) => x.id));
  const beforeIds = ids(before);
  const afterIds = ids(after);
  const added = [...afterIds].filter((id) => !beforeIds.has(id));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id));

  const backlinkChanges = [];
  const beforeById = new Map((before.concepts ?? []).map((x) => [x.id, x]));
  for (const cpt of after.concepts ?? []) {
    const prev = beforeById.get(cpt.id);
    if (prev && prev.backlinks !== cpt.backlinks) {
      backlinkChanges.push(`${cpt.id}: ${prev.backlinks} → ${cpt.backlinks}`);
    }
  }

  const line = (label, val) => console.log(`  ${label.padEnd(14)} ${val}`);
  line("concepts", `${after.concepts?.length ?? 0} (${added.length} added, ${removed.length} removed)`);
  line("connections", `${before.connections?.length ?? 0} → ${after.connections?.length ?? 0}`);
  line("emerging", `${before.emerging?.length ?? 0} → ${after.emerging?.length ?? 0}`);
  if (added.length) line("+ added", added.join(", "));
  if (removed.length) line("- removed", removed.join(", "));
  if (backlinkChanges.length) line("~ backlinks", backlinkChanges.join(" · "));
  if (!added.length && !removed.length && !backlinkChanges.length) {
    console.log(c.dim("  (concept set and backlink counts unchanged — likely only generatedAt / emerging counts moved)"));
  }
}

async function main() {
  console.log(c.bold("\nRefreshing the Studio from Obsidian (read-only)…"));

  const { vaultPath } = await loadConfig();
  const root = assertReadableVault(vaultPath); // dies clearly if unset / in-repo / missing

  step(1, "Snapshotting the vault (read-only)…");
  const before = await snapshotVault(root);
  console.log(c.dim(`  ${before.size} files fingerprinted.`));

  const prevRaw = existsSync(PROJECTION) ? await readTextOrNull(PROJECTION) : null;
  const prevProjection = parseOrNull(prevRaw ?? "");

  step(2, "Regenerating the sanitized projection…");
  await run("node", ["integrations/obsidian/project.mjs"], "Projection generator");

  step(3, "Verifying the vault was not modified…");
  const after = await snapshotVault(root);
  const drift = diffSnapshots(before, after);
  if (drift.length) {
    console.error(c.red("  Vault changed during refresh — this must never happen:"));
    for (const d of drift.slice(0, 20)) console.error(`    · ${d}`);
    die("Aborting: the vault was modified. The projection is not trustworthy.");
  }
  console.log(`  ${c.green("✓")} Vault untouched (${after.size} files identical).`);

  step(4, "Validating the projection is public-safe…");
  const { ok, violations, stats } = await validateProjection({ vaultPath: root });
  if (!ok) {
    console.error(c.red(`  ${violations.length} violation(s):`));
    for (const v of violations) console.error(`    · ${v}`);
    die("Aborting: the projection is not public-safe. It was NOT accepted.");
  }
  console.log(
    `  ${c.green("✓")} Public-safe — ${stats.concepts} concepts, ${stats.connections} connections, ${stats.emerging} emerging.`,
  );

  step(5, "Running lint and build…");
  await run("npm", ["run", "lint"], "Lint");
  await run("npm", ["run", "build"], "Build");
  console.log(`  ${c.green("✓")} Lint and build passed.`);

  step(6, "What changed in the projection:");
  const newProjection = parseOrNull((await readTextOrNull(PROJECTION)) ?? "");

  // A refresh should produce a diff ONLY when the projected knowledge changed.
  // If the substance is identical, restore the previous file byte-for-byte so the
  // regenerated generatedAt timestamp doesn't create repository noise.
  const unchanged =
    prevRaw !== null && substantiveKnowledge(prevProjection) === substantiveKnowledge(newProjection);
  if (unchanged) {
    await writeFile(PROJECTION, prevRaw);
    console.log(c.dim("  No substantive change — projection left untouched (generatedAt preserved)."));
  } else {
    summarizeProjectionDiff(prevProjection, newProjection);
  }

  console.log(`\n${c.green("✓ Studio refreshed.")} The vault was read-only and never touched.`);
  console.log(c.amber("  Nothing was committed."));
  console.log(c.dim("  Review, then commit yourself:"));
  console.log(c.dim("    git diff -- data/projections/obsidian.json"));
  console.log(c.dim("    git add data/projections/obsidian.json && git commit\n"));
}

main().catch((e) => die(e.stack || String(e)));
