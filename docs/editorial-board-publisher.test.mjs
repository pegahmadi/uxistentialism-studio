/*
 * Tests for docs/editorial-board-publisher.mjs (WS-3 / UXI-18).
 *
 * Every test runs the real CLI against a FRESH scratch inbox via the explicit
 * test-only override (EB_PUBLISHER_ALLOW_TEST_INBOX=1 + STUDIO_INBOX_DIR).
 * ~/.studio-inbox, Redis, Vercel, production, the vault, and secrets are never
 * touched. Run: node --test docs/editorial-board-publisher.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, chmodSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, "editorial-board-publisher.mjs");

function freshInbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eb-pub-"));
  mkdirSync(path.join(dir, "rejected"), { recursive: true });
  return dir;
}

function run(inbox, args, { input, forceId } = {}) {
  const env = { ...process.env, EB_PUBLISHER_ALLOW_TEST_INBOX: "1", STUDIO_INBOX_DIR: inbox };
  if (forceId) env.EB_PUBLISHER_FORCE_ID = forceId;
  const res = spawnSync(process.execPath, [PUB, ...args], { input: input ?? "", env, encoding: "utf8" });
  return { code: res.status, out: (res.stdout ?? "") + (res.stderr ?? "") };
}

function validArtifact() {
  return {
    sourceUpdatedAt: "2026-07-14T15:22:08.004Z",
    data: {
      manuscript: { id: "authority-architecture", title: "Authority Architecture", reviewRound: 4, status: "awaiting ruling" },
      reviewedAt: "2026-07-14T15:22:08.004Z",
      reviewers: [
        { role: "Evidence", diagnosis: "Section 3's mechanism claim rests on assertion.", recommendation: "Ground it in one real case.", confidence: "high" },
      ],
      unresolvedQuestions: ["Documented case, or observation first?"],
      rulings: [],
      nextDecision: "Rule on section 3.",
      sourceLabel: "Claude Editorial Board · automated",
      updatedAt: "2026-07-14T15:22:08.004Z",
      updatedBy: "claude",
    },
  };
}

const tokenOf = (out) => (out.match(/READY (\S+)/) || [])[1];
const idOf = (token) => token.slice(0, 32);
const tempPath = (inbox, id) => path.join(inbox, `.eb-publish-${id}.tmp`);
const finalCount = (inbox) => readdirSync(inbox).filter((n) => n.endsWith(".json")).length;

test("canonical prepare → publish success", () => {
  const inbox = freshInbox();
  const p = run(inbox, ["prepare"], { input: JSON.stringify(validArtifact()) });
  assert.equal(p.code, 0);
  const token = tokenOf(p.out);
  assert.match(token, /^[0-9a-f]{32}-[0-9a-f]{64}$/, "READY emits an opaque token");
  const pub = run(inbox, ["publish", token]);
  assert.equal(pub.code, 0);
  assert.match(pub.out, /^PUBLISHED editorial-board-.*\.json$/m);
  assert.equal(finalCount(inbox), 1, "one final artifact published");
  assert.ok(!existsSync(tempPath(inbox, idOf(token))), "temp removed after publish");
});

test("discard success removes the staged temp", () => {
  const inbox = freshInbox();
  const token = tokenOf(run(inbox, ["prepare"], { input: JSON.stringify(validArtifact()) }).out);
  assert.ok(existsSync(tempPath(inbox, idOf(token))));
  const d = run(inbox, ["discard", token]);
  assert.equal(d.code, 0);
  assert.match(d.out, /^DISCARDED$/m);
  assert.ok(!existsSync(tempPath(inbox, idOf(token))), "temp gone after discard");
  assert.equal(finalCount(inbox), 0, "nothing published");
});

test("modified bytes after prepare → publish refuses (digest mismatch)", () => {
  const inbox = freshInbox();
  const token = tokenOf(run(inbox, ["prepare"], { input: JSON.stringify(validArtifact()) }).out);
  const temp = tempPath(inbox, idOf(token));
  writeFileSync(temp, readFileSync(temp, "utf8") + " "); // one extra byte
  const pub = run(inbox, ["publish", token]);
  assert.equal(pub.code, 1);
  assert.match(pub.out, /^FAILED digest-mismatch$/m);
  assert.equal(finalCount(inbox), 0);
  assert.ok(!existsSync(temp), "temp cleaned up on failure");
});

test("different but valid artifact after approval → publish refuses (digest mismatch)", () => {
  const inbox = freshInbox();
  const token = tokenOf(run(inbox, ["prepare"], { input: JSON.stringify(validArtifact()) }).out);
  const temp = tempPath(inbox, idOf(token));
  const other = validArtifact();
  other.data.manuscript.title = "A Different Title"; // still valid, different bytes
  writeFileSync(temp, JSON.stringify(other) + "\n");
  const pub = run(inbox, ["publish", token]);
  assert.equal(pub.code, 1);
  assert.match(pub.out, /^FAILED digest-mismatch$/m);
  assert.equal(finalCount(inbox), 0);
});

test("invalid/path-like mutation with matching digest → publish refuses (revalidation)", () => {
  const inbox = freshInbox();
  const token = tokenOf(run(inbox, ["prepare"], { input: JSON.stringify(validArtifact()) }).out);
  const temp = tempPath(inbox, idOf(token));
  // Swap in path-like-invalid content AND forge a token whose digest matches it,
  // so the digest check passes and the INDEPENDENT revalidation must catch it.
  const bad = validArtifact();
  bad.data.nextDecision = "see /Users/pegah/notes/review.md";
  const bytes = JSON.stringify(bad) + "\n";
  writeFileSync(temp, bytes);
  const forged = idOf(token) + "-" + createHash("sha256").update(bytes).digest("hex");
  const pub = run(inbox, ["publish", forged]);
  assert.equal(pub.code, 1);
  assert.match(pub.out, /^FAILED revalidation-failed$/m);
  assert.equal(finalCount(inbox), 0);
  assert.ok(!existsSync(temp), "temp cleaned up on revalidation failure");
});

test("malformed token → rejected", () => {
  const inbox = freshInbox();
  for (const t of ["garbage", "", "abcd", "z".repeat(32) + "-" + "a".repeat(64), "a".repeat(32) + "-" + "b".repeat(63)]) {
    const pub = run(inbox, ["publish", t]);
    assert.equal(pub.code, 1, `token ${JSON.stringify(t)}`);
    assert.match(pub.out, /^FAILED malformed-token$/m, `token ${JSON.stringify(t)}`);
  }
});

test("absolute-path and traversal tokens → rejected as malformed", () => {
  const inbox = freshInbox();
  for (const t of ["/etc/passwd", "/absolute/path.tmp", "../traversal", "../../etc/passwd", "..%2F..%2Fetc"]) {
    const pub = run(inbox, ["publish", t]);
    assert.equal(pub.code, 1, `token ${JSON.stringify(t)}`);
    assert.match(pub.out, /^FAILED malformed-token$/m, `token ${JSON.stringify(t)}`);
    const d = run(inbox, ["discard", t]);
    assert.match(d.out, /^FAILED malformed-token$/m, `discard ${JSON.stringify(t)}`);
  }
});

test("symlink at the staged path → rejected", () => {
  const inbox = freshInbox();
  const id = "a".repeat(32);
  const token = id + "-" + "b".repeat(64);
  const target = path.join(inbox, "elsewhere.txt");
  writeFileSync(target, "secret-ish");
  symlinkSync(target, tempPath(inbox, id));
  const pub = run(inbox, ["publish", token]);
  assert.equal(pub.code, 1);
  assert.match(pub.out, /^FAILED symlink-rejected$/m);
  assert.equal(readFileSync(target, "utf8"), "secret-ish", "symlink target untouched");
  assert.equal(finalCount(inbox), 0);
});

test("non-regular file (directory) at the staged path → rejected", () => {
  const inbox = freshInbox();
  const id = "c".repeat(32);
  const token = id + "-" + "d".repeat(64);
  mkdirSync(tempPath(inbox, id));
  const pub = run(inbox, ["publish", token]);
  assert.equal(pub.code, 1);
  assert.match(pub.out, /^FAILED not-regular-file$/m);
});

test("exclusive-create collision → prepare fails closed", () => {
  const inbox = freshInbox();
  const id = "e".repeat(32);
  const squat = tempPath(inbox, id);
  writeFileSync(squat, "PRE-EXISTING");
  const p = run(inbox, ["prepare"], { input: JSON.stringify(validArtifact()), forceId: id });
  assert.equal(p.code, 1);
  assert.match(p.out, /^BLOCKED staging-collision$/m);
  assert.equal(readFileSync(squat, "utf8"), "PRE-EXISTING", "pre-existing file untouched");
});

test("staging error (non-EEXIST) attempts cleanup and reports without a path", () => {
  const inbox = freshInbox();
  chmodSync(inbox, 0o500); // read+execute, no write → exclusive create fails (EACCES/EPERM), not EEXIST
  try {
    const p = run(inbox, ["prepare"], { input: JSON.stringify(validArtifact()), forceId: "f".repeat(32) });
    assert.equal(p.code, 1);
    assert.match(p.out, /^BLOCKED staging-error-\w+$/m, "reports a generic staging error");
    assert.doesNotMatch(p.out, /staging-collision/, "must not be reported as a collision");
    assert.ok(!p.out.includes(inbox), "no inbox path in output");
    assert.ok(!/\/(Users|home)\//.test(p.out), "no home path in output");
    assert.ok(!p.out.includes(".tmp"), "no temp filename in output");
  } finally {
    chmodSync(inbox, 0o700);
  }
});

test("cleanup failure is surfaced (never silently ignored)", () => {
  const inbox = freshInbox();
  const token = tokenOf(run(inbox, ["prepare"], { input: JSON.stringify(validArtifact()) }).out);
  chmodSync(inbox, 0o500); // read+execute, no write → unlink of the child fails
  try {
    const d = run(inbox, ["discard", token]);
    assert.equal(d.code, 1);
    assert.match(d.out, /^FAILED cleanup-failed \w+$/m);
  } finally {
    chmodSync(inbox, 0o700); // restore so nothing lingers locked
  }
});

test("output never contains a private/absolute filesystem path", () => {
  const inbox = freshInbox();
  const p = run(inbox, ["prepare"], { input: JSON.stringify(validArtifact()) });
  const token = tokenOf(p.out);
  const pub = run(inbox, ["publish", token]);
  for (const out of [p.out, pub.out]) {
    assert.ok(!out.includes(inbox), "output must not leak the inbox path");
    assert.ok(!/\/(Users|home)\//.test(out), "output must not leak a home path");
    assert.ok(!out.includes(os.tmpdir()), "output must not leak the tmp dir path");
    assert.ok(!out.includes(".tmp"), "output must not name the staging temp file");
  }
});
