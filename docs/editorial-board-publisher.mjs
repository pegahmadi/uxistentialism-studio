/*
 * Editorial Board publisher — reference implementation of the external skill's
 * end-of-review publication step (WS-3 / UXI-18). Status: pending Codex review.
 *
 * This is the reviewable form of the skill change. The skill (hosted in Cowork,
 * outside this repo) runs three subcommands; Pegah approves between prepare and
 * publish. It performs ONLY the safety-critical, deterministic parts. The skill
 * never rm's a supplied path — it calls `discard <token>` instead.
 *
 *   prepare   (stdin = the two-key artifact JSON)
 *     Validates §2b (validateInboxArtifact), length caps, and the public-safety
 *     scan. If any fail → prints BLOCKED <reason>, writes NO temp, exits 1;
 *     publish is never offered. On a full pass it computes a SHA-256 digest of
 *     the staged bytes, writes them to a temp created EXCLUSIVELY (flag "wx") at
 *     mode 0600, prints the bounded checkpoint report, and prints
 *     `READY <token>` — an OPAQUE token (no filesystem path), a 32-hex staging
 *     id joined to the 64-hex digest. Only a clean artifact reaches the human
 *     checkpoint.
 *
 *   publish <token>
 *     Resolves the token strictly to a direct inbox child (rejecting traversal,
 *     absolute paths, symlinks, non-regular files, and malformed tokens),
 *     RECOMPUTES the digest and compares it to the token's digest (binding
 *     publication to the exact artifact Pegah approved), then RE-RUNS schema
 *     validation + caps + public-safety. Any mismatch or failure publishes
 *     nothing. On full agreement it hard-links the temp to the final
 *     editorial-board-<ts>-<uuid>.json (atomic; no overwrite; no partial
 *     visibility). ANY link failure — not only EEXIST — publishes nothing.
 *     Never retries with mv, cp, overwrite, or a direct POST.
 *
 *   discard <token>
 *     Resolves the token the same hardened way and attempts to remove the temp
 *     (used when Pegah declines at the checkpoint). Never operates on a
 *     caller-supplied path.
 *
 * On every applicable failure path the staged temp's removal is ATTEMPTED, and a
 * cleanup failure is surfaced generically (WARN/FAILED cleanup-failed <code>) —
 * never silently ignored, never printing a path. A cleanup warning means the
 * staged non-.json temp may still remain; it must then be handled through the
 * Coordinator — never republish, and never construct or rm a path manually. (An
 * EEXIST collision is not a temp we created, so it is preserved, not removed.)
 * The publisher never constructs a transport envelope, chooses
 * revision/payloadHash, authenticates to the Studio, holds the sync secret, or
 * asserts human authorship — those remain the companion's and the human write
 * path's alone.
 */

import { readFileSync, writeFileSync, linkSync, unlinkSync, lstatSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { validateInboxArtifact } from "../companion/validator.mjs";
import { scanPublicSafety } from "../tools/public-safety.mjs";

// TEST-ONLY inbox override. Honored ONLY when EB_PUBLISHER_ALLOW_TEST_INBOX=1,
// so production can never redirect the inbox by accident. The skill never sets
// these; production always targets ~/.studio-inbox exactly.
const TEST_MODE = process.env.EB_PUBLISHER_ALLOW_TEST_INBOX === "1";
const INBOX = TEST_MODE && process.env.STUDIO_INBOX_DIR
  ? process.env.STUDIO_INBOX_DIR
  : path.join(os.homedir(), ".studio-inbox");
const INBOX_RESOLVED = path.resolve(INBOX);
// TEST-ONLY: force the staging id so an exclusive-create collision is testable.
const TEST_FORCE_ID = TEST_MODE ? process.env.EB_PUBLISHER_FORCE_ID : undefined;

const MAX = { diagnosis: 500, recommendation: 500, question: 300, nextDecision: 300 };
const TOKEN_RE = /^([0-9a-f]{32})-([0-9a-f]{64})$/;

/** Length caps from §2b — a summary that outgrows its cap stops being a summary. */
function capViolations(d) {
  const v = [];
  d?.reviewers?.forEach((r, i) => {
    if ((r.diagnosis?.length ?? 0) > MAX.diagnosis) v.push(`reviewers[${i}].diagnosis > ${MAX.diagnosis}`);
    if ((r.recommendation?.length ?? 0) > MAX.recommendation) v.push(`reviewers[${i}].recommendation > ${MAX.recommendation}`);
  });
  d?.unresolvedQuestions?.forEach((q, i) => {
    if ((q?.length ?? 0) > MAX.question) v.push(`unresolvedQuestions[${i}] > ${MAX.question}`);
  });
  if ((d?.nextDecision?.length ?? 0) > MAX.nextDecision) v.push(`nextDecision > ${MAX.nextDecision}`);
  return v;
}

/** Remove a staged temp. ENOENT = already gone = ok. Other codes are surfaced. */
function removeTemp(p) {
  try {
    unlinkSync(p);
    return { ok: true };
  } catch (e) {
    if (e?.code === "ENOENT") return { ok: true };
    return { ok: false, code: e?.code ?? "error" };
  }
}

/** Emit a generic cleanup-failure line (never a path) when removal fails. */
function warnIfCleanupFailed(rm) {
  if (!rm.ok) console.log(`WARN cleanup-failed ${rm.code}`);
}

/**
 * Resolve an opaque token to a direct inbox child. The strict hex shape makes
 * traversal / absolute-path tokens malformed by construction; we still confirm
 * the resolved path is a direct child of the inbox (defense-in-depth).
 */
function resolveToken(token) {
  const m = TOKEN_RE.exec(typeof token === "string" ? token : "");
  if (!m) return { err: "malformed-token" };
  const [, id, digest] = m;
  const temp = path.join(INBOX_RESOLVED, `.eb-publish-${id}.tmp`);
  if (path.dirname(temp) !== INBOX_RESOLVED) return { err: "resolution-escape" };
  return { id, digest, temp };
}

/** lstat guard: the staged path must be a real, regular file — never a symlink. */
function assertRegularFile(temp) {
  let st;
  try {
    st = lstatSync(temp); // lstat: does NOT follow symlinks
  } catch (e) {
    return { err: e?.code === "ENOENT" ? "no-temp" : `stat-${e?.code ?? "error"}` };
  }
  if (st.isSymbolicLink()) return { err: "symlink-rejected" };
  if (!st.isFile()) return { err: "not-regular-file" };
  return { st };
}

function prepare() {
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(0, "utf8")); // fd 0 = stdin (the skill pipes it)
  } catch {
    console.log("BLOCKED not-valid-JSON");
    return 1;
  }

  // Gate BEFORE writing any temp, so a blocked artifact leaves nothing behind.
  const schema = validateInboxArtifact(artifact);
  if (schema.length) {
    console.log("BLOCKED validation-fail: " + schema.join("; "));
    return 1;
  }
  const data = artifact.data;
  const caps = capViolations(data);
  if (caps.length) {
    console.log("BLOCKED length-caps-exceeded: " + caps.join("; "));
    return 1;
  }
  const scan = scanPublicSafety(artifact);
  if (scan.length) {
    // Redacted: category + JSON trail only, never the offending value.
    console.log("BLOCKED public-safety-hits: " + scan.join("; "));
    return 1;
  }

  // Full pass → stage bytes, digest them, write exclusively at mode 0600.
  const bytes = JSON.stringify(artifact) + "\n";
  const digest = createHash("sha256").update(bytes, "utf8").digest("hex");
  const id = TEST_FORCE_ID ?? randomBytes(16).toString("hex");
  const temp = path.join(INBOX_RESOLVED, `.eb-publish-${id}.tmp`);
  try {
    writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 }); // wx = exclusive create
  } catch (e) {
    if (e?.code === "EEXIST") {
      // Collision: the path already exists. It is NOT a file we created, so we
      // never remove it — preserve it and report. No path is printed.
      console.log("BLOCKED staging-collision");
      return 1;
    }
    // Any other error may have left a partial temp — attempt cleanup and surface
    // a cleanup failure generically. No path is printed.
    const rm = removeTemp(temp);
    console.log(`BLOCKED staging-error-${e?.code ?? "error"}`);
    warnIfCleanupFailed(rm);
    return 1;
  }
  const token = `${id}-${digest}`;

  // Bounded checkpoint report — metadata + the exact summaries that become LIVE
  // Iteration content. No manuscript body exists in the artifact to print, and
  // no filesystem path is ever emitted (the token is opaque).
  console.log("VALIDATION: PASS");
  console.log(`manuscript: ${data.manuscript.id} · round ${data.manuscript.reviewRound} · status ${data.manuscript.status}`);
  console.log(`counts: reviewers=${data.reviewers.length} questions=${data.unresolvedQuestions.length} rulings=${data.rulings.length}`);
  console.log(`provenance: updatedBy=${data.updatedBy} · sourceLabel exact=${data.sourceLabel === "Claude Editorial Board · automated"}`);
  console.log("length caps respected: true · public-safety scan: clean");
  console.log("--- bounded summaries that will become LIVE Iteration content ---");
  for (const r of data.reviewers) console.log(`  [${r.role} · ${r.confidence}] ${r.diagnosis} -> ${r.recommendation}`);
  for (const q of data.unresolvedQuestions) console.log(`  Q: ${q}`);
  console.log(`  nextDecision: ${data.nextDecision}`);
  console.log(`READY ${token}`);
  return 0;
}

function publish(token) {
  const r = resolveToken(token);
  if (r.err) {
    console.log(`FAILED ${r.err}`);
    return 1;
  }
  const chk = assertRegularFile(r.temp);
  if (chk.err) {
    // Unverified / missing / symlink / non-regular: do not remove — it may not
    // be a file we staged.
    console.log(`FAILED ${chk.err}`);
    return 1;
  }

  let bytes;
  try {
    bytes = readFileSync(r.temp);
  } catch (e) {
    console.log(`FAILED read-${e?.code ?? "error"}`);
    return 1;
  }

  // (1) Bind to the approved artifact: recompute + compare the digest.
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== r.digest) {
    const rm = removeTemp(r.temp);
    console.log("FAILED digest-mismatch");
    warnIfCleanupFailed(rm);
    return 1;
  }

  // (2) Independently re-run schema validation + caps + public-safety.
  let artifact;
  try {
    artifact = JSON.parse(bytes.toString("utf8"));
  } catch {
    const rm = removeTemp(r.temp);
    console.log("FAILED revalidation-failed");
    warnIfCleanupFailed(rm);
    return 1;
  }
  const problems = [
    ...validateInboxArtifact(artifact),
    ...capViolations(artifact?.data),
    ...scanPublicSafety(artifact),
  ];
  if (problems.length) {
    const rm = removeTemp(r.temp);
    console.log("FAILED revalidation-failed");
    warnIfCleanupFailed(rm);
    return 1;
  }

  // (3) Publish via hard link (atomic, no overwrite, no partial visibility).
  const stamp = artifact.sourceUpdatedAt.replace(/[:.]/g, "-");
  const final = path.join(INBOX_RESOLVED, `editorial-board-${stamp}-${randomUUID()}.json`);
  try {
    linkSync(r.temp, final);
  } catch (e) {
    const rm = removeTemp(r.temp); // ANY link failure → publish nothing
    console.log(`FAILED link-${e?.code ?? "error"}`);
    warnIfCleanupFailed(rm);
    return 1;
  }

  const rm = removeTemp(r.temp); // final persists as a separate link
  console.log(`PUBLISHED ${path.basename(final)}`);
  warnIfCleanupFailed(rm);
  return 0;
}

function discard(token) {
  const r = resolveToken(token);
  if (r.err) {
    console.log(`FAILED ${r.err}`);
    return 1;
  }
  const chk = assertRegularFile(r.temp);
  if (chk.err) {
    console.log(`FAILED ${chk.err}`);
    return 1;
  }
  const rm = removeTemp(r.temp);
  if (!rm.ok) {
    console.log(`FAILED cleanup-failed ${rm.code}`);
    return 1;
  }
  console.log("DISCARDED");
  return 0;
}

const cmd = process.argv[2];
let code;
if (cmd === "prepare") code = prepare();
else if (cmd === "publish") code = publish(process.argv[3]);
else if (cmd === "discard") code = discard(process.argv[3]);
else {
  console.log("usage: editorial-board-publisher.mjs prepare            (stdin: artifact JSON)");
  console.log("       editorial-board-publisher.mjs publish <token>");
  console.log("       editorial-board-publisher.mjs discard <token>");
  code = 2;
}
process.exit(code);
