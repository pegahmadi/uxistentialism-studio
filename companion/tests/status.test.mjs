#!/usr/bin/env node
/* Status store tests (WS-2): two independent persisted revision sequences,
 * restart survival, atomic crash-safe writes, 409 recovery math, mode 600. */

import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStatusStore } from "../status.mjs";
import { check, summary } from "./_helpers.mjs";

const dir = await mkdtemp(path.join(tmpdir(), "ws2-status-"));
const statusPath = path.join(dir, "status.json");

console.log("Fresh store:");
let store = await createStatusStore({ statusPath });
check("first obsidian revision is 1", store.nextRevision("obsidianProjection") === 1);
check("first editorial-board revision is 1", store.nextRevision("editorialBoard") === 1);

console.log("Independent sequences + persistence across restart:");
await store.recordSuccess("obsidianProjection", { revision: 1, payloadHash: "sha256-aaa" });
await store.recordSuccess("obsidianProjection", { revision: 2, payloadHash: "sha256-bbb" });
await store.recordSuccess("editorialBoard", { revision: 1, payloadHash: "sha256-ccc" });

// simulated restart: new store instance reading the same file
store = await createStatusStore({ statusPath });
check("obsidian sequence survives restart", store.nextRevision("obsidianProjection") === 3);
check("editorial-board sequence survives restart (independent)", store.nextRevision("editorialBoard") === 2);
check("lastSuccess persisted", store.get("obsidianProjection").lastSuccess !== null);
check("payloadHash persisted", store.get("obsidianProjection").lastPayloadHash === "sha256-bbb");

const st = await stat(statusPath);
check("status file is mode 600", (st.mode & 0o777) === 0o600, (st.mode & 0o777).toString(8));

console.log("409 recovery math (§6):");
const successBeforeConflict = store.get("editorialBoard").lastSuccess;
await store.recordConflict("editorialBoard", { storedRevision: 41, error: "duplicate" });
check("lastRevision recovered to storedRevision", store.get("editorialBoard").lastRevision === 41);
check("next submission uses storedRevision + 1", store.nextRevision("editorialBoard") === 42);
check("conflict recorded visibly", store.get("editorialBoard").lastConflict?.error === "duplicate");
check("lastSuccess untouched by conflict", store.get("editorialBoard").lastSuccess === successBeforeConflict);
check("conflict does not disturb the other sequence", store.nextRevision("obsidianProjection") === 3);

console.log("Atomic crash-safety (failure between temp write and rename):");
const before = await readFile(statusPath, "utf8");
const crashing = await createStatusStore({
  statusPath,
  fsOps: {
    rename: async () => {
      throw new Error("simulated crash before rename");
    },
  },
});
let threw = false;
try {
  await crashing.recordSuccess("obsidianProjection", { revision: 99, payloadHash: "sha256-zzz" });
} catch {
  threw = true;
}
const after = await readFile(statusPath, "utf8");
check("failed write propagates", threw);
check("prior state fully intact on disk", before === after);
const leftovers = (await readdir(dir)).filter((n) => n.includes(".tmp-"));
check("no temp files left behind", leftovers.length === 0, leftovers);

// reload from disk: revision 99 must NOT have taken effect
store = await createStatusStore({ statusPath });
check("crashed write cannot roll the sequence forward", store.nextRevision("obsidianProjection") === 3);

console.log("Serialized writes (FIX 7): reversed rename completion cannot lose a revision:");
{
  const { rename: realRename, writeFile: realWriteFile } = await import("node:fs/promises");
  const serPath = path.join(dir, "serialized.json");
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  // The FIRST rename is delayed past the second: without serialization the
  // second (newer) write lands first and the stale first rename then
  // overwrites it, losing the other endpoint's revision on restart.
  let renameCalls = 0;
  const slow = await createStatusStore({
    statusPath: serPath,
    fsOps: {
      rename: async (a, b) => {
        renameCalls += 1;
        if (renameCalls === 1) await sleepMs(120);
        return realRename(a, b);
      },
    },
  });
  await Promise.all([
    slow.recordSuccess("obsidianProjection", { revision: 7, payloadHash: "sha256-obs" }),
    (async () => {
      await sleepMs(10); // starts after the first write, finishes long before its rename would
      await slow.recordSuccess("editorialBoard", { revision: 3, payloadHash: "sha256-brd" });
    })(),
  ]);
  check("both renames ran", renameCalls === 2, renameCalls);

  // Restart: BOTH endpoints' latest sequences must be on disk.
  const reloaded = await createStatusStore({ statusPath: serPath });
  check("obsidian revision survives concurrent write", reloaded.nextRevision("obsidianProjection") === 8, reloaded.get("obsidianProjection").lastRevision);
  check("editorial-board revision survives concurrent write", reloaded.nextRevision("editorialBoard") === 4, reloaded.get("editorialBoard").lastRevision);

  // A failed write must not poison the queue.
  let failNext = true;
  const flaky = await createStatusStore({
    statusPath: serPath,
    fsOps: {
      writeFile: async (...args) => {
        if (failNext) {
          failNext = false;
          throw Object.assign(new Error("ENOSPC (simulated)"), { code: "ENOSPC" });
        }
        return realWriteFile(...args);
      },
    },
  });
  let failed = false;
  try {
    await flaky.recordSuccess("obsidianProjection", { revision: 8, payloadHash: "sha256-x" });
  } catch {
    failed = true;
  }
  check("failed write rejects its caller", failed);
  await flaky.recordSuccess("editorialBoard", { revision: 4, payloadHash: "sha256-y" });
  const afterFlaky = await createStatusStore({ statusPath: serPath });
  check("queue not poisoned: the next write persists", afterFlaky.get("editorialBoard").lastRevision === 4);
}

console.log("Corrupt status file:");
const corruptPath = path.join(dir, "corrupt.json");
await (await import("node:fs/promises")).writeFile(corruptPath, "{ not json");
const fresh = await createStatusStore({ statusPath: corruptPath });
check("corrupt file starts fresh (409 path self-heals revisions)", fresh.nextRevision("obsidianProjection") === 1);

await rm(dir, { recursive: true, force: true });
summary("status");
