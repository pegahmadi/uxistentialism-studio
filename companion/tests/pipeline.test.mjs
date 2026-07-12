#!/usr/bin/env node
/* Pipeline tests (WS-2): synthetic vault → real projector → real validator →
 * real envelope → mock HTTP server, with a real status store. Covers success,
 * idempotent reconciliation, 409 recovery math, validation failure (no
 * submission), VaultError handling, and secret absence across every flow.
 * NEVER touches the real vault. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { substantiveHash } from "../../tools/canonical-hash.mjs";
import { createLogger } from "../logger.mjs";
import { createStatusStore } from "../status.mjs";
import { createIngestor } from "../ingestor.mjs";
import { createSyncPipeline } from "../sync-pipeline.mjs";
import { runProjection } from "../projector.mjs";
import { check, summary, startMockServer, makeSyntheticVault, validArtifact } from "./_helpers.mjs";

const SECRET = "sk-super-secret-token-123";
const { root: vaultPath, allowlistPath } = await makeSyntheticVault();
const stateDir = await mkdtemp(path.join(tmpdir(), "ws2-pipeline-"));
const allLines = [];

// A tiny §6-faithful mock server: idempotent when the recomputed substantive
// hash matches; conflict scripting via `script` overrides.
function makeServer(scriptFn) {
  let stored = null; // { hash, revision }
  return startMockServer((record, n) => {
    const scripted = scriptFn?.(record, n, stored);
    if (scripted) return scripted;
    const recomputed = substantiveHash(record.body.data);
    if (stored && recomputed === stored.hash) return { status: 200, body: { ok: true, status: "idempotent" } };
    stored = { hash: recomputed, revision: record.body.revision };
    return { status: 200, body: { ok: true, status: "accepted" } };
  });
}

async function makeStack(serverUrl, { statusFile, projectFn } = {}) {
  const lines = [];
  const logger = createLogger({
    redactions: [[SECRET, "[redacted-secret]"], [vaultPath, "[vault]"]],
    sink: (l) => {
      lines.push(l);
      allLines.push(l);
    },
  });
  const status = await createStatusStore({ statusPath: path.join(stateDir, statusFile ?? "status.json"), logger });
  const ingestor = createIngestor({ studioUrl: serverUrl, syncSecret: SECRET, logger, sleep: async () => {} });
  // config-shaped object; allowlistPath threaded through a wrapped projectFn
  const config = { vaultPath, studioUrl: serverUrl };
  const pipeline = createSyncPipeline({
    config,
    status,
    ingestor,
    logger,
    projectFn: projectFn ?? (({ vaultPath: vp }) => runProjection({ vaultPath: vp })),
  });
  return { pipeline, status, logger, lines };
}

// The synthetic projector projects against the synthetic allowlist, while the
// pipeline's Obsidian validator checks the REPO allowlist — so synthetic
// concept ids (alpha/beta) legitimately fail local validation. That mismatch
// is used deliberately below to prove validation failures block submission;
// positive validator coverage lives in validator.test.mjs, and positive
// pipeline coverage runs through the editorial-board flow (same envelope +
// status + ingest tail).
import { project } from "../../integrations/obsidian/project.mjs";

const projectSynthetic = ({ vaultPath: vp }) => project({ vaultPath: vp, allowlistPath });

console.log("Validation failure blocks submission (no HTTP request):");
{
  const server = await makeServer();
  const { pipeline, status, lines } = await makeStack(server.url, { statusFile: "s-blocked.json", projectFn: projectSynthetic });
  // synthetic concepts alpha/beta are NOT in the repo allowlist → local
  // validation must fail and nothing may reach the server.
  const r = await pipeline.syncObsidian();
  check("outcome is validation-error", r.outcome === "validation-error", r.outcome);
  check("no request reached the server", server.requests.length === 0, server.requests.length);
  check("status records the failure without submission", status.get("obsidianProjection").lastError?.includes("validation failed"));
  check("violations logged (redacted)", lines.some((l) => l.includes("projection validation:")));
  check("revision not consumed", status.nextRevision("obsidianProjection") === 1);
  await server.close();
}

console.log("Successful sync via editorial-board flow (full envelope, real status):");
{
  const server = await makeServer();
  const { pipeline, status } = await makeStack(server.url, { statusFile: "s-board.json" });
  const r = await pipeline.submitEditorialBoard(validArtifact());
  check("success", r.outcome === "success" && r.status === "accepted", r);
  const sent = server.requests[0].body;
  check("envelope is companion-built", sent.source === "editorial-board-inbox" && sent.schemaVersion === 1 && sent.revision === 1);
  check("sourceUpdatedAt taken verbatim from the artifact", sent.sourceUpdatedAt === "2026-07-12T18:04:07.123Z");
  check("payloadHash matches shared reference", sent.payloadHash === substantiveHash(sent.data));
  const s = status.get("editorialBoard");
  check("lastSuccess + revision + hash persisted", s.lastSuccess !== null && s.lastRevision === 1 && s.lastPayloadHash === sent.payloadHash);
  check("obsidian sequence untouched (independence)", status.nextRevision("obsidianProjection") === 1);

  // Same data again → server idempotent → still success; revision advances.
  const r2 = await pipeline.submitEditorialBoard(validArtifact());
  check("idempotent resubmission is a success (§6)", r2.outcome === "success" && r2.status === "idempotent", r2);
  check("lastSuccess refreshed on idempotent", status.get("editorialBoard").lastRevision === 2);
  await server.close();
}

console.log("409 recovery math through the pipeline:");
{
  const server = await makeServer((record, n) =>
    n === 1
      ? { status: 409, body: { ok: false, error: "duplicate", storedRevision: 41, storedProjectedAt: "2026-07-12T17:00:00.000Z" } }
      : null,
  );
  const { pipeline, status } = await makeStack(server.url, { statusFile: "s-conflict.json" });
  const r = await pipeline.submitEditorialBoard(validArtifact());
  check("conflict surfaced, not success", r.outcome === "conflict");
  const s = status.get("editorialBoard");
  check("no lastSuccess on conflict", s.lastSuccess === null);
  check("lastConflict visible in status", s.lastConflict?.error === "duplicate");
  check("sequence recovered to storedRevision", s.lastRevision === 41);

  const r2 = await pipeline.submitEditorialBoard(validArtifact());
  check("next submission uses storedRevision + 1", r2.outcome === "success" && server.requests[1].body.revision === 42, server.requests[1]?.body?.revision);
  await server.close();
}

console.log("Invalid artifact never reaches the wire:");
{
  const server = await makeServer();
  const { pipeline, status } = await makeStack(server.url, { statusFile: "s-invalid.json" });
  const bad = validArtifact();
  bad.data.rulings = [{ on: "scope", decision: "approved" }];
  const r = await pipeline.submitEditorialBoard(bad);
  check("validation-error outcome", r.outcome === "validation-error");
  check("zero requests sent", server.requests.length === 0);
  check("status shows the failure", status.get("editorialBoard").lastError?.includes("validation failed"));
  await server.close();
}

console.log("VaultError (incl. VAULT_EMPTY) recorded, never submitted:");
{
  const server = await makeServer();
  const { pipeline, status } = await makeStack(server.url, {
    statusFile: "s-vaulterr.json",
    projectFn: ({ vaultPath: vp }) => project({ vaultPath: path.join(vp, "nonexistent-subdir"), allowlistPath }),
  });
  const r = await pipeline.syncObsidian();
  check("projection-error outcome", r.outcome === "projection-error", r.outcome);
  check("no request sent", server.requests.length === 0);
  check("VaultError code recorded", status.get("obsidianProjection").lastError?.includes("VAULT_NOT_FOUND"), status.get("obsidianProjection").lastError);
  await server.close();
}

console.log("Secret and vault-path absence across ALL pipeline flows:");
check("secret never in any log line", allLines.every((l) => !l.includes(SECRET)));
check("vault path never in any log line", allLines.every((l) => !l.includes(vaultPath)));
check("logs were produced", allLines.length > 0, allLines.length);

await rm(vaultPath, { recursive: true, force: true });
await rm(allowlistPath, { force: true });
await rm(stateDir, { recursive: true, force: true });
summary("pipeline");
