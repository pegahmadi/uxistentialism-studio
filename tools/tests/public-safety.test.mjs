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
  ["etc path", "/etc/config/x contents"],
  ["generic multi-segment absolute path", "/opt/data/thing"],
  ["Windows drive path (backslash)", "C:\\Users\\pegah\\vault"],
  ["Windows drive path (forward slash)", "C:/Users/name/private/file"],
  ["UNC path", "\\\\server\\share\\file"],
  ["file URI", "file:///Users/pegah/x"],
  ["md filename", "described in Authority.md"],
  ["md inside path", "notes/Authority.md today"],
]) check(label, leaksPath(s) === true, s);

console.log("Punctuation-wrapped / embedded paths (must leak):");
for (const [label, s] of [
  ["parenthesized path", "(/home/user/private/note)"],
  ["double-quoted path", '"/var/private/data"'],
  ["assignment path", "path=/tmp/private/file"],
  ["markdown link path", "[source](/home/user/note)"],
  ["colon-prefixed path", "dir:/var/private/data"],
  ["comma-separated path", "a,/home/user/private/x"],
  ["bracketed path", "[/opt/private/data]"],
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
  ["https URL with deep path", "https://example.com/a/b/c"],
  ["ratio", "3/4 of reviewers agree"],
  ["parenthesized ratio", "(3/4)"],
  ["quoted word/word", '"either/or"'],
  ["parenthesized relative path", "see (notes/today)"],
  ["date with slashes", "on 07/12/2026"],
  ["prose colon-slash single word", "Substack:/publish is not a drive"],
  ["madrid contains md", "the Madrid team"],
]) check(label, leaksPath(s) === false, s);

console.log("Forbidden keys at any depth:");
check("nested body key", scanPublicSafety({ a: { body: "x" } }).some((v) => v.includes('"body"')));
check("nested transcript key", scanPublicSafety({ a: [{ transcript: "x" }] }).some((v) => v.includes('"transcript"')));
check("nested vaultKey key", scanPublicSafety({ x: { y: { vaultKey: "k" } } }).length === 1);
check("clean object has no violations", scanPublicSafety({ title: "Alpha", summary: "Fine.", presentIn: ["today"] }).length === 0);
check("leak inside array reported with trail", scanPublicSafety({ qs: ["ok", "/home/x/y"] })[0]?.includes("$.qs[1]"));

console.log("Redaction (violations never repeat the offending content):");
{
  const secretPath = "/home/user/secret-note";
  const vs = scanPublicSafety({ concepts: [{ summary: `see (${secretPath}) here` }] });
  const joined = JSON.stringify(vs);
  check("leak detected", vs.length === 1, vs);
  check("violation names category + trail", vs[0] === "path-like string detected at $.concepts[0].summary", vs[0]);
  check("submitted private path absent from every message", !joined.includes(secretPath) && !joined.includes("secret-note") && !joined.includes("/home/user"), joined);
}
{
  const vault = "/Users/pegah/SecretVault";
  const vs = scanPublicSafety({ s: "mentions SecretVault content" }, { extraNeedles: ["SecretVault"] });
  check("extraNeedles violation redacted too", vs.length === 1 && !JSON.stringify(vs).includes("SecretVault"), vs);
  check("vault path needle never echoed", !JSON.stringify(vs).includes(vault));
}

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
  projection: { ...goodProjection, concepts: [{ ...goodProjection.concepts[0], summary: "see /home/x/note", body: "LEAK" }] },
});
check("poisoned in-memory projection fails", bad.ok === false);
check("catches forbidden key via shared primitive", bad.violations.some((v) => v.includes('"body"')));
check("catches POSIX path via shared primitive", bad.violations.some((v) => v.includes("path-like string")));
check("validator violations never echo the leaked path", !JSON.stringify(bad.violations).includes("/home/x"));

console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
