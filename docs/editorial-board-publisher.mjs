/*
 * Editorial Board publisher — reference implementation of the external skill's
 * end-of-review publication step (WS-3 / UXI-18).
 *
 * This is the reviewable form of the skill change. The skill (hosted in Cowork,
 * outside this repo) runs these two subcommands with Pegah's approval between
 * them. It performs ONLY the safety-critical, deterministic parts — validation,
 * the pre-publication gate, the atomic hard-link publish, and cleanup. The skill
 * orchestrates: it generates the artifact, pipes it to `prepare`, shows Pegah the
 * checkpoint, obtains explicit approval, then calls `publish`.
 *
 *   prepare   (stdin = the two-key artifact JSON)
 *     Validates §2b (validateInboxArtifact), checks length caps, runs the
 *     public-safety scan. CLARIFICATION 1: if validation FAILS, any length cap
 *     is exceeded, OR the scan reports ANY hit → print BLOCKED with the reason,
 *     write NO temp (nothing to publish, nothing left behind), exit 1. Publish is
 *     never offered for a failing artifact. On full pass → write a non-.json temp
 *     the companion ignores, print the bounded checkpoint report, print
 *     "READY <tempPath>", exit 0. Only a clean artifact ever reaches the human
 *     checkpoint.
 *
 *   publish <tempPath>
 *     Hard-links the (approved) temp to the final editorial-board-<ts>-<uuid>.json.
 *     A hard link is atomic, never overwrites, and never exposes a partial file.
 *     CLARIFICATION 2: ANY link failure — not only EEXIST — is a failed
 *     publication: delete the temp, print FAILED <code>, exit 1. Never retry with
 *     mv, cp, overwrite, or a direct POST. On success → delete the temp (the final
 *     link persists until the companion submits it), print PUBLISHED <name>, exit 0.
 *
 * On ANY failure at any step the temp is removed: review data is never left in
 * the inbox or in /tmp.
 *
 * The skill NEVER: constructs a transport envelope, chooses revision/payloadHash,
 * authenticates to the Studio, holds the sync secret, or asserts human authorship.
 */

import { readFileSync, writeFileSync, linkSync, unlinkSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { validateInboxArtifact } from "../companion/validator.mjs";
import { scanPublicSafety } from "../tools/public-safety.mjs";

// The live inbox. STUDIO_INBOX_DIR is a TEST-ONLY override (scratch inbox for the
// publisher's own path tests); the skill never sets it, so production targets
// ~/.studio-inbox exactly.
const INBOX = process.env.STUDIO_INBOX_DIR || path.join(os.homedir(), ".studio-inbox");

const MAX = { diagnosis: 500, recommendation: 500, question: 300, nextDecision: 300 };

function safeUnlink(p) {
  try {
    unlinkSync(p);
  } catch {
    /* already gone */
  }
}

/** Length caps from §2b — a summary that outgrows its cap stops being a summary. */
function capViolations(d) {
  const v = [];
  d.reviewers?.forEach((r, i) => {
    if ((r.diagnosis?.length ?? 0) > MAX.diagnosis) v.push(`reviewers[${i}].diagnosis > ${MAX.diagnosis}`);
    if ((r.recommendation?.length ?? 0) > MAX.recommendation) v.push(`reviewers[${i}].recommendation > ${MAX.recommendation}`);
  });
  d.unresolvedQuestions?.forEach((q, i) => {
    if ((q?.length ?? 0) > MAX.question) v.push(`unresolvedQuestions[${i}] > ${MAX.question}`);
  });
  if ((d.nextDecision?.length ?? 0) > MAX.nextDecision) v.push(`nextDecision > ${MAX.nextDecision}`);
  return v;
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

  // Full pass → write a non-.json temp in the inbox (companion's filter ignores
  // non-.json and the rejected/ subtree; same directory as the final link so the
  // hard link stays on one filesystem).
  const temp = path.join(INBOX, `.eb-publish-${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(artifact) + "\n", { mode: 0o600 });

  // Bounded checkpoint report — metadata + the exact summaries that become LIVE
  // Iteration content. No manuscript body exists in the artifact to print.
  console.log("VALIDATION: PASS");
  console.log(`manuscript: ${data.manuscript.id} · round ${data.manuscript.reviewRound} · status ${data.manuscript.status}`);
  console.log(`counts: reviewers=${data.reviewers.length} questions=${data.unresolvedQuestions.length} rulings=${data.rulings.length}`);
  console.log(`provenance: updatedBy=${data.updatedBy} · sourceLabel exact=${data.sourceLabel === "Claude Editorial Board · automated"}`);
  console.log("length caps respected: true · public-safety scan: clean");
  console.log("--- bounded summaries that will become LIVE Iteration content ---");
  for (const r of data.reviewers) console.log(`  [${r.role} · ${r.confidence}] ${r.diagnosis} -> ${r.recommendation}`);
  for (const q of data.unresolvedQuestions) console.log(`  Q: ${q}`);
  console.log(`  nextDecision: ${data.nextDecision}`);
  console.log(`READY ${temp}`);
  return 0;
}

function publish(temp) {
  if (!temp || !existsSync(temp)) {
    console.log("FAILED no-temp");
    return 1;
  }
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(temp, "utf8"));
  } catch {
    safeUnlink(temp);
    console.log("FAILED temp-unreadable");
    return 1;
  }
  // sourceUpdatedAt was validated exact-ISO in prepare; derive the filename stamp.
  const stamp = artifact.sourceUpdatedAt.replace(/[:.]/g, "-");
  const final = path.join(INBOX, `editorial-board-${stamp}-${randomUUID()}.json`);
  try {
    linkSync(temp, final); // atomic; fails without overwriting if final exists
  } catch (e) {
    safeUnlink(temp); // CLARIFICATION 2: ANY link failure → cleanup + stop
    console.log(`FAILED link-${e?.code ?? "error"}`);
    return 1;
  }
  safeUnlink(temp); // final persists as a separate link until the companion submits it
  console.log(`PUBLISHED ${path.basename(final)}`);
  return 0;
}

const cmd = process.argv[2];
let code;
if (cmd === "prepare") code = prepare();
else if (cmd === "publish") code = publish(process.argv[3]);
else {
  console.log("usage: editorial-board-publisher.mjs prepare   (stdin: artifact JSON)");
  console.log("       editorial-board-publisher.mjs publish <tempPath>");
  code = 2;
}
process.exit(code);
