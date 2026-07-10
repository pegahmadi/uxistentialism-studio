#!/usr/bin/env node
/*
 * UXistentialism Studio — Vault Audit (M1: read-only scanner)
 *
 * Reads an Obsidian vault (the thinking archive) and emits a metadata manifest
 * plus a human-readable report. It NEVER writes, renames, or deletes anything in
 * the vault: files are opened read-only, and the only writes are to the repo's
 * gitignored .vault-audit/ output directory.
 *
 * Usage:
 *   VAULT_PATH="/path/to/Vault" node tools/vault-audit/scan.mjs
 *   # or set { "vaultPath": "..." } in tools/vault-audit/audit.config.json
 *
 * No dependencies. No network. Deterministic.
 */

import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, ".vault-audit");
const DEFAULT_SKIP = [".obsidian", ".trash", ".git", ".stversions", "node_modules"];

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function loadConfig() {
  let vaultPath = process.env.VAULT_PATH || null;
  let skipFolders = [...DEFAULT_SKIP];
  const cfgPath = path.join(__dirname, "audit.config.json");
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
      if (!vaultPath && cfg.vaultPath) vaultPath = cfg.vaultPath;
      if (Array.isArray(cfg.skipFolders)) skipFolders = [...DEFAULT_SKIP, ...cfg.skipFolders];
    } catch (e) {
      fail(`Could not parse ${cfgPath}: ${e.message}`);
    }
  }
  return { vaultPath, skipFolders };
}

function assertReadableVault(vaultPath) {
  if (!vaultPath) {
    fail(
      "No vault path. Set VAULT_PATH or vaultPath in tools/vault-audit/audit.config.json\n" +
        '  Example: VAULT_PATH="/Users/you/Obsidian/Vault" node tools/vault-audit/scan.mjs',
    );
  }
  const resolved = path.resolve(vaultPath);
  if (!existsSync(resolved)) fail(`Vault path does not exist: ${resolved}`);
  const rel = path.relative(REPO_ROOT, resolved);
  const insideRepo = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (insideRepo) {
    fail(`Refusing to scan: vault path is inside this repo (${resolved}). The vault must live outside the repo.`);
  }
  return resolved;
}

async function walk(dir, skip, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith(".") || skip.includes(e.name)) continue;
      await walk(full, skip, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function stripQuotes(s) {
  return s.replace(/^["'\[]+/, "").replace(/["'\]]+$/, "").trim();
}

// Intentionally light: the vault's frontmatter is inconsistent, so this captures
// simple `key: value` and `- item` lists without a full YAML dependency.
function parseFrontmatter(raw) {
  const data = {};
  let currentKey = null;
  for (const line of raw.split(/\r?\n/)) {
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(stripQuotes(listMatch[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_ -]+?)\s*:\s*(.*)$/);
    if (kv) {
      currentKey = kv[1].trim();
      const val = kv[2].trim();
      data[currentKey] = val === "" ? [] : stripQuotes(val);
    }
  }
  return data;
}

function splitFrontmatter(content) {
  if (!content.startsWith("---")) return { fm: null, body: content };
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: content };
  return { fm: parseFrontmatter(m[1]), body: content.slice(m[0].length) };
}

function toList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function linkBasename(raw) {
  const target = raw.split("|")[0].split("#")[0].trim();
  return target.split("/").pop().toLowerCase();
}

function analyze(content) {
  const { fm, body } = splitFrontmatter(content);

  const headings = [];
  for (const m of body.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)) {
    headings.push({ level: m[1].length, text: m[2].trim() });
  }
  const h1 = headings.find((h) => h.level === 1);

  const outbound = [];
  for (const m of body.matchAll(/\[\[([^\]]+?)\]\]/g)) outbound.push(linkBasename(m[1]));

  const inlineTags = [];
  for (const m of body.matchAll(/(?:^|\s)#([A-Za-z][A-Za-z0-9_/-]*)/g)) inlineTags.push(m[1].toLowerCase());

  const urls = [];
  for (const m of body.matchAll(/https?:\/\/[^\s)>\]]+/g)) urls.push(m[0]);

  const words = body.replace(/[#>*_`~\-]/g, " ").trim().split(/\s+/).filter(Boolean).length;

  const fmTags = fm ? toList(fm.tags || fm.tag).map((t) => String(t).replace(/^#/, "").toLowerCase()) : [];
  const aliases = fm ? toList(fm.aliases || fm.alias) : [];

  return {
    fm,
    hasFrontmatter: !!fm,
    frontmatterKeys: fm ? Object.keys(fm) : [],
    title: h1 ? h1.text : null,
    aliases,
    tags: Array.from(new Set([...fmTags, ...inlineTags])),
    headingCount: headings.length,
    headings: headings.slice(0, 12),
    outbound: Array.from(new Set(outbound)),
    externalUrlCount: urls.length,
    wordCount: words,
    hasTodo: /\b(TODO|WIP|FIXME|DRAFT)\b/i.test(body),
  };
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

async function main() {
  const { vaultPath, skipFolders } = await loadConfig();
  const root = assertReadableVault(vaultPath);

  console.log(`Reading vault (read-only): ${root}`);
  const files = await walk(root, skipFolders);
  console.log(`Found ${files.length} markdown notes. Analyzing...`);

  const notes = [];
  for (const file of files) {
    let content = "";
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const st = await stat(file);
    const relPath = path.relative(root, file);
    const segments = relPath.split(path.sep);
    const folder = segments.length > 1 ? segments[0] : "(root)";
    const fileName = path.basename(file);
    const key = fileName.replace(/\.md$/i, "").toLowerCase();

    const a = analyze(content);
    notes.push({
      relPath,
      folder,
      fileName,
      key,
      title: a.title || fileName.replace(/\.md$/i, ""),
      missingTitle: !a.title,
      hasFrontmatter: a.hasFrontmatter,
      frontmatterKeys: a.frontmatterKeys,
      aliases: a.aliases,
      tags: a.tags,
      isQuestion: (a.title || fileName).trim().endsWith("?") || a.tags.includes("question"),
      wordCount: a.wordCount,
      headingCount: a.headingCount,
      headings: a.headings,
      outbound: a.outbound,
      outboundCount: a.outbound.length,
      externalUrlCount: a.externalUrlCount,
      hasTodo: a.hasTodo,
      inboundCount: 0,
      mtime: st.mtime.toISOString(),
      birthtime: st.birthtime.toISOString(),
    });
  }

  // Resolve links → backlinks, unresolved targets, duplicates.
  const keySet = new Set();
  const byKey = new Map();
  for (const n of notes) {
    keySet.add(n.key);
    for (const al of n.aliases) keySet.add(String(al).toLowerCase());
    if (!byKey.has(n.key)) byKey.set(n.key, []);
    byKey.get(n.key).push(n);
  }

  const inbound = new Map();
  const unresolved = new Map();
  for (const n of notes) {
    for (const target of n.outbound) {
      if (target === n.key) continue;
      if (keySet.has(target)) {
        inbound.set(target, (inbound.get(target) || 0) + 1);
      } else {
        unresolved.set(target, (unresolved.get(target) || 0) + 1);
      }
    }
  }
  for (const n of notes) n.inboundCount = inbound.get(n.key) || 0;
  for (const n of notes) n.isOrphan = n.inboundCount === 0 && n.outboundCount === 0;

  // Aggregates
  const byFolder = new Map();
  for (const n of notes) {
    const f = byFolder.get(n.folder) || { count: 0, words: 0, withFm: 0 };
    f.count++;
    f.words += n.wordCount;
    if (n.hasFrontmatter) f.withFm++;
    byFolder.set(n.folder, f);
  }

  const tagFreq = new Map();
  for (const n of notes) for (const t of n.tags) tagFreq.set(t, (tagFreq.get(t) || 0) + 1);

  const duplicates = [...byKey.entries()].filter(([, arr]) => arr.length > 1);
  const orphans = notes.filter((n) => n.isOrphan);
  const noFrontmatter = notes.filter((n) => !n.hasFrontmatter);
  const hubs = [...notes].sort((a, b) => b.inboundCount - a.inboundCount).slice(0, 15);
  const topUnresolved = [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);

  const summary = {
    noteCount: notes.length,
    totalWords: notes.reduce((s, n) => s + n.wordCount, 0),
    withFrontmatter: notes.length - noFrontmatter.length,
    orphanCount: orphans.length,
    unresolvedLinkCount: unresolved.size,
    duplicateNameGroups: duplicates.length,
    folders: [...byFolder.keys()].length,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();

  await writeFile(
    path.join(OUT_DIR, "vault-manifest.json"),
    JSON.stringify({ generatedAt, vaultPath: root, summary, notes }, null, 2),
  );

  const report = buildReport({
    generatedAt,
    root,
    summary,
    byFolder,
    hubs,
    orphans,
    noFrontmatter,
    topUnresolved,
    topTags,
    duplicates,
  });
  await writeFile(path.join(OUT_DIR, "audit-report.md"), report);

  console.log("\n✓ Read-only scan complete. The vault was not modified.");
  console.log(`  Notes:            ${fmt(summary.noteCount)}`);
  console.log(`  With frontmatter: ${fmt(summary.withFrontmatter)}`);
  console.log(`  Orphans:          ${fmt(summary.orphanCount)}`);
  console.log(`  Unresolved links: ${fmt(summary.unresolvedLinkCount)}  (elevate candidates)`);
  console.log(`  Duplicate names:  ${fmt(summary.duplicateNameGroups)}`);
  console.log(`\n  Outputs (gitignored):`);
  console.log(`    .vault-audit/vault-manifest.json`);
  console.log(`    .vault-audit/audit-report.md`);
}

function buildReport(d) {
  const L = [];
  L.push(`# Vault Audit Report`);
  L.push(``);
  L.push(`_Generated ${d.generatedAt} — read-only scan; the vault was not modified._`);
  L.push(``);
  L.push(`Vault: \`${d.root}\``);
  L.push(``);
  L.push(`## Overview`);
  L.push(``);
  L.push(`| Metric | Value |`);
  L.push(`|---|---|`);
  L.push(`| Notes | ${fmt(d.summary.noteCount)} |`);
  L.push(`| Total words | ${fmt(d.summary.totalWords)} |`);
  L.push(`| With frontmatter | ${fmt(d.summary.withFrontmatter)} |`);
  L.push(`| Orphans (no links in or out) | ${fmt(d.summary.orphanCount)} |`);
  L.push(`| Unresolved link targets | ${fmt(d.summary.unresolvedLinkCount)} |`);
  L.push(`| Duplicate-name groups | ${fmt(d.summary.duplicateNameGroups)} |`);
  L.push(``);

  L.push(`## By folder`);
  L.push(``);
  L.push(`| Folder | Notes | Avg words | With frontmatter |`);
  L.push(`|---|--:|--:|--:|`);
  for (const [folder, f] of [...d.byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const avg = f.count ? Math.round(f.words / f.count) : 0;
    L.push(`| ${folder} | ${fmt(f.count)} | ${fmt(avg)} | ${fmt(f.withFm)} |`);
  }
  L.push(``);

  L.push(`## Backlink hubs (most-referenced notes)`);
  L.push(``);
  for (const n of d.hubs.filter((n) => n.inboundCount > 0)) {
    L.push(`- **${n.title}** — ${n.inboundCount} backlinks · \`${n.relPath}\``);
  }
  L.push(``);

  L.push(`## Ontology signals (preview — full recommendations in M3)`);
  L.push(``);
  L.push(`### Referenced but missing — elevate candidates`);
  L.push(`Wikilink targets that no note satisfies. Often emergent concepts worth a note.`);
  L.push(``);
  for (const [target, count] of d.topUnresolved) {
    L.push(`- \`[[${target}]]\` — referenced ${count}×`);
  }
  L.push(``);
  L.push(`### Duplicate names — merge/rename candidates`);
  L.push(``);
  if (d.duplicates.length === 0) L.push(`_None found._`);
  for (const [key, arr] of d.duplicates.slice(0, 25)) {
    L.push(`- \`${key}\` → ${arr.map((n) => `\`${n.relPath}\``).join(", ")}`);
  }
  L.push(``);
  L.push(`### Top tags`);
  L.push(``);
  L.push(d.topTags.map(([t, c]) => `\`#${t}\` (${c})`).join(" · ") || "_None._");
  L.push(``);

  L.push(`## Orphans (no links in or out — archive/connect candidates)`);
  L.push(``);
  L.push(`${fmt(d.orphans.length)} notes. First 40:`);
  L.push(``);
  for (const n of d.orphans.slice(0, 40)) L.push(`- \`${n.relPath}\` (${n.wordCount} words)`);
  L.push(``);

  L.push(`## Notes without frontmatter`);
  L.push(``);
  L.push(`${fmt(d.noFrontmatter.length)} notes. (Expected — this is a mixed vault.)`);
  L.push(``);

  return L.join("\n") + "\n";
}

main().catch((e) => fail(e.stack || String(e)));
