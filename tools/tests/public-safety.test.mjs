#!/usr/bin/env node
/*
 * Locks the §5 public-safety primitive (tools/public-safety.mjs) and the
 * in-memory validateProjection bridge (contract v1.1.1).
 *
 * Portable: no Redis, no vault, no config.
 * Usage: node tools/tests/public-safety.test.mjs
 */

import { leaksPath, scanPublicSafety } from "../public-safety.mjs";
import { validateProjection } from "../validate-projection.mjs";

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`); }
}

console.log("Cross-platform path detection (must leak):");
for (const [label, s] of [
  ["macOS home path", "see /Users/pegah/vault/note"],
  ["Linux home path", "/home/user/notes/x"],
  ["var path", "logged to /var/log/app.log"],
  ["tmp path", "/tmp/a/b"],
  ["etc path", "/etc/passwd contents"],
  ["generic multi-segment absolute path", "/opt/data/thing"],
  ["Windows drive path", "C:\\Users\\pegah\\vault"],
  ["UNC path", "\\\\server\\share\\file"],
  ["file URI", "file:///Users/pegah/x"],
  ["md filename", "described in Authority.md"],
  ["md inside path", "notes/Authority.md today"],
]) check(label, leaksPath(s) === true, s);

console.log("Legitimate content (must NOT leak):");
for (const [label, s] of [
  ["prose summary", "Governance for AI-native systems is an architecture problem."],
  ["status value", "in review"],
  ["ISO timestamp", "2026-07-12T18:04:07.123Z"],
  ["clock time", "meeting at 10:30 tomorrow"],
  ["word/word token", "read/write access and either/or choices"],
  ["bare slash", "a / b"],
  ["https URL", "https://example.com/essay"],
  ["ratio", "3/4 of reviewers agree"],
  ["madrid contains md", "the Madrid team"],
]) check(label, leaksPath(s) === false, s);

console.log("Forbidden keys at any depth:");
check("nested body key", scanPublicSafety({ a: { body: "x" } }).some((v) => v.includes('"body"')));
check("nested transcript key", scanPublicSafety({ a: [{ transcript: "x" }] }).some((v) => v.includes('"transcript"')));
check("nested vaultKey key", scanPublicSafety({ x: { y: { vaultKey: "k" } } }).length === 1);
check("clean object has no violations", scanPublicSafety({ title: "Alpha", summary: "Fine.", presentIn: ["today"] }).length === 0);
check("leak inside array reported with trail", scanPublicSafety({ qs: ["ok", "/home/x/y"] })[0]?.includes("$.qs[1]"));

console.log("extraNeedles (vault path):");
check("configured vault path flagged", scanPublicSafety({ s: "in MyVault/Zettel" }, { extraNeedles: ["MyVault"] }).length === 1);

console.log("In-memory validateProjection bridge:");
const goodProjection = {
  generatedAt: new Date().toISOString(),
  concepts: [{ id: "authority-architecture", title: "A", kind: "core", category: "authority", summary: "Fine.", presentIn: ["today"], backlinks: 1 }],
  connections: [],
  emerging: [{ term: "decision memory", references: 2 }],
};
const good = await validateProjection({ projection: goodProjection });
check("valid in-memory projection passes (no file read)", good.ok === true, good.violations);

const bad = await validateProjection({
  projection: { ...goodProjection, concepts: [{ ...goodProjection.concepts[0], summary: "see /home/x/note.md", body: "LEAK" }] },
});
check("poisoned in-memory projection fails", bad.ok === false);
check("catches forbidden key via shared primitive", bad.violations.some((v) => v.includes('"body"')));
check("catches POSIX path via shared primitive", bad.violations.some((v) => v.includes("path-like string")));

console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
