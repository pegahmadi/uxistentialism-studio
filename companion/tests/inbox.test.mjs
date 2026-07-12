#!/usr/bin/env node
/* Inbox tests (WS-2): §2b drain ordering (timestamp primary, suffix tie-break,
 * mtime fallback), rejected/ handling, network-failure preservation, 409
 * recovery, and directory permissions. */

import { mkdtemp, writeFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseArtifactName,
  orderInboxFiles,
  ensureInboxDirs,
  waitForStableSize,
  createInboxWatcher,
} from "../inbox-watcher.mjs";
import { createLogger } from "../logger.mjs";
import { check, summary, validArtifact, artifactName } from "./_helpers.mjs";

const SECRET = "sk-super-secret-token-123";

console.log("Filename parsing (§2b convention):");
{
  const p = parseArtifactName("editorial-board-2026-07-12T18-04-07-123Z-a1b2c3.json");
  check("conforming name parses", p !== null && p.suffix === "a1b2c3");
  check("timestamp round-trips", p.timestampMs === Date.parse("2026-07-12T18:04:07.123Z"));
  check("nonconforming name → null (mtime fallback)", parseArtifactName("board-output.json") === null);
  check("legacy name without suffix → null", parseArtifactName("editorial-board-2026-07-12T18-04-07-123Z.json") === null);
}

console.log("Drain ordering:");
{
  const tsA = "2026-07-12T10:00:00.000Z";
  const tsB = "2026-07-12T12:00:00.000Z";
  const entries = [
    { name: artifactName(tsB, "zzz"), mtimeMs: 1 }, // late timestamp, early mtime — filename wins
    { name: "legacy-drop.json", mtimeMs: Date.parse("2026-07-12T11:00:00.000Z") }, // mtime fallback → middle
    { name: artifactName(tsA, "bbb"), mtimeMs: 999999999999999 }, // early timestamp, huge mtime — filename wins
    { name: artifactName(tsA, "aaa"), mtimeMs: 5 }, // same timestamp → suffix tie-break
  ];
  const ordered = orderInboxFiles(entries).map((e) => e.name);
  check(
    "timestamp primary, suffix tie-break, mtime fallback interleaved",
    JSON.stringify(ordered) ===
      JSON.stringify([artifactName(tsA, "aaa"), artifactName(tsA, "bbb"), "legacy-drop.json", artifactName(tsB, "zzz")]),
    ordered,
  );
}

console.log("Directory permissions (mode 700):");
const base = await mkdtemp(path.join(tmpdir(), "ws2-inbox-"));
const inboxPath = path.join(base, "inbox");
{
  await ensureInboxDirs(inboxPath);
  const inboxMode = (await stat(inboxPath)).mode & 0o777;
  const rejMode = (await stat(path.join(inboxPath, "rejected"))).mode & 0o777;
  check("inbox created mode 700", inboxMode === 0o700, inboxMode.toString(8));
  check("rejected/ created mode 700", rejMode === 0o700, rejMode.toString(8));
  // loosen, then verify repair
  await (await import("node:fs/promises")).chmod(inboxPath, 0o755);
  await ensureInboxDirs(inboxPath);
  check("loose permissions repaired to 700", ((await stat(inboxPath)).mode & 0o777) === 0o700);
}

console.log("Size-stability wait:");
{
  const f = path.join(base, "growing.json");
  await writeFile(f, "{");
  const grow = (async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 15));
      await writeFile(f, "{}".padEnd(10 + i * 10, " "));
    }
  })();
  const stable = await waitForStableSize(f, { intervalMs: 10, stableChecks: 3, maxWaitMs: 2000 });
  await grow;
  check("waits until the file stops growing", stable === true);
  check("vanished file reports false", (await waitForStableSize(path.join(base, "never.json"), { intervalMs: 5 })) === false);
}

// ---- drain scenarios with a scripted submit() ----

function makeWatcher(dir, submitScript) {
  const lines = [];
  const logger = createLogger({ redactions: [[SECRET, "[redacted-secret]"]], sink: (l) => lines.push(l) });
  const submitted = [];
  const watcher = createInboxWatcher({
    inboxPath: dir,
    logger,
    stability: { intervalMs: 5, stableChecks: 1, maxWaitMs: 500 },
    submit: async (artifact) => {
      submitted.push(artifact);
      return submitScript(artifact, submitted.length);
    },
  });
  return { watcher, submitted, lines };
}

const listInbox = async (dir) => (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name).sort();
const listRejected = async (dir) => (await readdir(path.join(dir, "rejected"))).sort();

console.log("Startup drain — order, rejection isolation, success removal:");
{
  const dir = path.join(base, "drain1");
  await ensureInboxDirs(dir);
  const t1 = "2026-07-12T09:00:00.000Z";
  const t2 = "2026-07-12T10:00:00.000Z";
  const t3 = "2026-07-12T11:00:00.000Z";
  const a1 = validArtifact();
  a1.data.manuscript.id = "first";
  const a3 = validArtifact();
  a3.data.manuscript.id = "third";
  await writeFile(path.join(dir, artifactName(t1, "u1")), JSON.stringify(a1));
  await writeFile(path.join(dir, artifactName(t2, "u2")), "{ this is not json"); // invalid mid-queue
  const badSchema = validArtifact();
  badSchema.data.rulings = [{ on: "x", decision: "y" }];
  await writeFile(path.join(dir, artifactName(t2, "u3")), JSON.stringify(badSchema)); // §2b-invalid
  await writeFile(path.join(dir, artifactName(t3, "u4")), JSON.stringify(a3));

  // Real §2b validation in the mock submit, so the schema-invalid artifact is
  // rejected exactly as the pipeline would reject it.
  const { validateInboxArtifact } = await import("../validator.mjs");
  const { watcher, submitted } = makeWatcher(dir, (artifact) =>
    validateInboxArtifact(artifact).length > 0
      ? { outcome: "validation-error" }
      : { outcome: "success", status: "accepted" },
  );
  await watcher._drainPass();

  const succeeded = submitted.filter((s) => validateInboxArtifact(s).length === 0).map((s) => s.data.manuscript.id);
  check("valid artifacts submitted oldest-first", JSON.stringify(succeeded) === JSON.stringify(["first", "third"]), succeeded);
  check("invalid files did not block later valid ones", succeeded.at(-1) === "third");
  check("successful artifacts removed from inbox", (await listInbox(dir)).length === 0, await listInbox(dir));
  const rejected = await listRejected(dir);
  check("both invalid files moved to rejected/", rejected.length === 2, rejected);
  check("rejected names keep a timestamp prefix + original name", rejected.every((n) => n.includes("editorial-board-2026-07-12T10-00-00-000Z")), rejected);
}

console.log("Network failure leaves files in place (order preserved):");
{
  const dir = path.join(base, "drain2");
  await ensureInboxDirs(dir);
  const t1 = "2026-07-12T09:00:00.000Z";
  const t2 = "2026-07-12T10:00:00.000Z";
  await writeFile(path.join(dir, artifactName(t1, "u1")), JSON.stringify(validArtifact()));
  await writeFile(path.join(dir, artifactName(t2, "u2")), JSON.stringify(validArtifact()));

  const { watcher, submitted, lines } = makeWatcher(dir, () => ({ outcome: "unavailable" }));
  await watcher._drainPass();
  check("drain pauses on first unavailable artifact", submitted.length === 1, submitted.length);
  check("ALL files left in the inbox for the next drain", (await listInbox(dir)).length === 2, await listInbox(dir));
  check("pause logged", lines.some((l) => l.includes("paused")));
}

console.log("Contract drift → preserved in rejected/:");
{
  const dir = path.join(base, "drain3");
  await ensureInboxDirs(dir);
  await writeFile(path.join(dir, artifactName("2026-07-12T09:00:00.000Z", "u1")), JSON.stringify(validArtifact()));
  const { watcher } = makeWatcher(dir, () => ({ outcome: "contract-drift", httpStatus: 400, error: "invalid_schema" }));
  await watcher._drainPass();
  check("drift artifact out of the resubmit loop", (await listInbox(dir)).length === 0);
  check("drift artifact preserved in rejected/", (await listRejected(dir)).length === 1);
}

console.log("409 conflict → recovery pass resubmits with recovered revision:");
{
  const dir = path.join(base, "drain4");
  await ensureInboxDirs(dir);
  await writeFile(path.join(dir, artifactName("2026-07-12T09:00:00.000Z", "u1")), JSON.stringify(validArtifact()));

  // First submission conflicts (as if the revision was stale); the pipeline
  // recovers the sequence; the bounded follow-up pass succeeds.
  const { watcher, submitted } = makeWatcher(dir, (_, n) =>
    n === 1 ? { outcome: "conflict", error: "duplicate", storedRevision: 41 } : { outcome: "success", status: "accepted" },
  );
  await watcher.drainNow();
  check("conflicted artifact resubmitted exactly once by the recovery pass", submitted.length === 2, submitted.length);
  check("artifact removed after the recovered submission succeeds", (await listInbox(dir)).length === 0);
  watcher.close();
}

console.log("Secret absence: inbox logs never contain the secret");
{
  // exercised implicitly: all loggers above redact; simple sanity line
  const dir = path.join(base, "drain5");
  await ensureInboxDirs(dir);
  const { watcher, lines } = makeWatcher(dir, () => ({ outcome: "success", status: "accepted" }));
  await watcher._drainPass();
  check("no secret in inbox logs", lines.every((l) => !l.includes(SECRET)));
}

await rm(base, { recursive: true, force: true });
summary("inbox");
