/*
 * Shared read-only layer for the vault audit tools.
 *
 * Read-only by construction: opens vault files for reading only; the only writes
 * (done by callers) go to the repo's gitignored .vault-audit/ output dir.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const OUT_DIR = path.join(REPO_ROOT, ".vault-audit");

const DEFAULT_SKIP = [".obsidian", ".trash", ".git", ".stversions", "node_modules", "Templates"];

export function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

export async function loadConfig() {
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

export function assertReadableVault(vaultPath) {
  if (!vaultPath) {
    fail(
      "No vault path. Set VAULT_PATH or vaultPath in tools/vault-audit/audit.config.json",
    );
  }
  const resolved = path.resolve(vaultPath);
  if (!existsSync(resolved)) fail(`Vault path does not exist: ${resolved}`);
  const rel = path.relative(REPO_ROOT, resolved);
  const insideRepo = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (insideRepo) fail(`Refusing to scan: vault path is inside this repo (${resolved}).`);
  return resolved;
}

export async function walk(dir, skip, out = []) {
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
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

function linkBasename(raw) {
  return raw.split("|")[0].split("#")[0].trim().split("/").pop().toLowerCase();
}

// M1 refinement: don't treat generic section headers as a note's title.
function isBoilerplateHeading(h) {
  const s = h.toLowerCase().trim();
  return (
    s.length < 3 ||
    /^(why this|why it matters|overview|summary|introduction|intro|notes?|context|definition|tl;?dr)\b/.test(s)
  );
}

function pickTitle(fm, h1) {
  const fmTitle =
    fm && (typeof fm.title === "string" ? fm.title : null);
  if (fmTitle) return fmTitle;
  if (h1 && !isBoilerplateHeading(h1)) return h1;
  return null;
}

export function analyze(content) {
  const { fm, body } = splitFrontmatter(content);

  const headings = [];
  for (const m of body.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)) {
    headings.push({ level: m[1].length, text: m[2].replace(/\*\*/g, "").trim() });
  }
  const h1e = headings.find((h) => h.level === 1);
  const h1 = h1e ? h1e.text : null;

  const outbound = [];
  for (const m of body.matchAll(/\[\[([^\]]+?)\]\]/g)) outbound.push(linkBasename(m[1]));

  const inlineTags = [];
  for (const m of body.matchAll(/(?:^|\s)#([A-Za-z][A-Za-z0-9_/-]*)/g)) inlineTags.push(m[1].toLowerCase());

  const urls = [];
  for (const m of body.matchAll(/https?:\/\/[^\s)>\]]+/g)) urls.push(m[0]);

  const words = body.replace(/[#>*_`~-]/g, " ").trim().split(/\s+/).filter(Boolean).length;

  const fmTags = fm ? toList(fm.tags || fm.tag).map((t) => String(t).replace(/^#/, "").toLowerCase()) : [];
  // M1 refinement: drop hex-color and pure-numeric false tags.
  const tags = Array.from(new Set([...fmTags, ...inlineTags])).filter(
    (t) => !/^[0-9a-f]{3,8}$/i.test(t) && !/^\d+$/.test(t),
  );
  const aliases = fm ? toList(fm.aliases || fm.alias) : [];
  const title = pickTitle(fm, h1);

  return {
    fm,
    body,
    hasFrontmatter: !!fm,
    frontmatterKeys: fm ? Object.keys(fm) : [],
    h1,
    title,
    aliases,
    tags,
    isQuestion: (title || "").trim().endsWith("?") || tags.includes("question"),
    headingCount: headings.length,
    headings: headings.slice(0, 12),
    outbound: Array.from(new Set(outbound)),
    externalUrlCount: urls.length,
    wordCount: words,
    hasTodo: /\b(TODO|WIP|FIXME|DRAFT)\b/i.test(body),
  };
}

export async function loadNotes() {
  const { vaultPath, skipFolders } = await loadConfig();
  const root = assertReadableVault(vaultPath);
  const files = await walk(root, skipFolders);
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
    const segs = relPath.split(path.sep);
    const folder = segs.length > 1 ? segs[0] : "(root)";
    const fileName = path.basename(file);
    const fileBase = fileName.replace(/\.md$/i, "");
    const a = analyze(content);
    notes.push({
      relPath,
      folder,
      fileName,
      fileBase,
      key: fileBase.toLowerCase(),
      title: a.title || fileBase,
      h1: a.h1,
      missingTitle: !a.h1,
      hasFrontmatter: a.hasFrontmatter,
      frontmatterKeys: a.frontmatterKeys,
      aliases: a.aliases,
      tags: a.tags,
      isQuestion: a.isQuestion,
      wordCount: a.wordCount,
      headingCount: a.headingCount,
      headings: a.headings,
      outbound: a.outbound,
      outboundCount: a.outbound.length,
      externalUrlCount: a.externalUrlCount,
      hasTodo: a.hasTodo,
      mtime: st.mtime.toISOString(),
      mtimeMs: st.mtimeMs,
      birthtime: st.birthtime.toISOString(),
      inboundCount: 0,
      body: a.body,
    });
  }
  return { root, notes };
}

// Resolve wikilinks → inbound counts, referencing notes, unresolved targets,
// and duplicate-named notes (M1 refinement: dedupe-key aware).
export function computeGraph(notes) {
  const keyToNotes = new Map();
  const aliasToKey = new Map();
  for (const n of notes) {
    if (!keyToNotes.has(n.key)) keyToNotes.set(n.key, []);
    keyToNotes.get(n.key).push(n);
    for (const al of n.aliases) aliasToKey.set(String(al).toLowerCase(), n.key);
  }
  const inbound = new Map();
  const inboundFrom = new Map();
  const unresolved = new Map();
  for (const n of notes) {
    for (const t of n.outbound) {
      const target = keyToNotes.has(t) ? t : aliasToKey.get(t) || t;
      if (target === n.key) continue;
      if (keyToNotes.has(target)) {
        inbound.set(target, (inbound.get(target) || 0) + 1);
        if (!inboundFrom.has(target)) inboundFrom.set(target, new Set());
        inboundFrom.get(target).add(n.relPath);
      } else if (!aliasToKey.has(target)) {
        if (!unresolved.has(target)) unresolved.set(target, { count: 0, from: new Set() });
        const u = unresolved.get(target);
        u.count++;
        u.from.add(n.relPath);
      }
    }
  }
  for (const n of notes) n.inboundCount = inbound.get(n.key) || 0;
  const duplicates = [...keyToNotes.entries()].filter(([, a]) => a.length > 1);
  return { keyToNotes, aliasToKey, inbound, inboundFrom, unresolved, duplicates };
}

export function fmt(n) {
  return n.toLocaleString("en-US");
}
