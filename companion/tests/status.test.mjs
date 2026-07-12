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

console.log("Corrupt status file:");
const corruptPath = path.join(dir, "corrupt.json");
await (await import("node:fs/promises")).writeFile(corruptPath, "{ not json");
const fresh = await createStatusStore({ statusPath: corruptPath });
check("corrupt file starts fresh (409 path self-heals revisions)", fresh.nextRevision("obsidianProjection") === 1);

await rm(dir, { recursive: true, force: true });
summary("status");
