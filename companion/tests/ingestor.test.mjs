#!/usr/bin/env node
/* Ingestor tests (WS-2): response classification per §6, retry policy, and
 * secret-absence from logs across every flow. Uses a local node:http mock. */

import { createLogger } from "../logger.mjs";
import { createIngestor } from "../ingestor.mjs";
import { buildEnvelope } from "../envelope.mjs";
import { check, summary, startMockServer, validBoardData } from "./_helpers.mjs";

const SECRET = "sk-super-secret-token-123";
const envelope = buildEnvelope({
  source: "editorial-board-inbox",
  sourceUpdatedAt: "2026-07-12T18:04:07.123Z",
  data: validBoardData(),
  revision: 3,
});

const allLines = [];
function makeIngestor(url, overrides = {}) {
  const lines = [];
  const logger = createLogger({
    redactions: [[SECRET, "[redacted-secret]"]],
    sink: (l) => {
      lines.push(l);
      allLines.push(l);
    },
  });
  const ingestor = createIngestor({
    studioUrl: url,
    syncSecret: SECRET,
    logger,
    sleep: async () => {}, // no real 5s waits in tests
    ...overrides,
  });
  return { ingestor, lines };
}

console.log("200 accepted:");
{
  const server = await startMockServer(() => ({ status: 200, body: { ok: true, status: "accepted" } }));
  const { ingestor } = makeIngestor(server.url);
  const r = await ingestor.submit("/api/ingest/editorial-board", envelope);
  check("outcome success/accepted", r.outcome === "success" && r.status === "accepted", r);
  check("exactly one request (no retry on success)", server.requests.length === 1);
  const req = server.requests[0];
  check("Bearer auth header sent", req.headers.authorization === `Bearer ${SECRET}`);
  check("content-type application/json", req.headers["content-type"] === "application/json");
  check("full envelope on the wire", req.body.schemaVersion === 1 && req.body.revision === 3 && req.body.payloadHash === envelope.payloadHash);
  await server.close();
}

console.log("200 idempotent (success — §6 heartbeat):");
{
  const server = await startMockServer(() => ({ status: 200, body: { ok: true, status: "idempotent" } }));
  const { ingestor } = makeIngestor(server.url);
  const r = await ingestor.submit("/api/ingest/obsidian", envelope);
  check("outcome success/idempotent", r.outcome === "success" && r.status === "idempotent", r);
  await server.close();
}

console.log("409 conflict (non-retryable):");
{
  const server = await startMockServer(() => ({
    status: 409,
    body: { ok: false, error: "duplicate", message: "revision too low", storedRevision: 41, storedProjectedAt: "2026-07-12T17:00:00.000Z" },
  }));
  const { ingestor } = makeIngestor(server.url);
  const r = await ingestor.submit("/api/ingest/editorial-board", envelope);
  check("outcome conflict with storedRevision", r.outcome === "conflict" && r.storedRevision === 41, r);
  check("409 never retried", server.requests.length === 1, server.requests.length);
  await server.close();
}

console.log("401 / 400 (4xx — contract drift, no retry):");
{
  const server = await startMockServer((_, n) => (n === 1 ? { status: 401, body: { ok: false, error: "auth_failed" } } : { status: 400, body: { ok: false, error: "invalid_schema" } }));
  const { ingestor, lines } = makeIngestor(server.url);
  const r1 = await ingestor.submit("/api/ingest/obsidian", envelope);
  check("401 → contract-drift outcome, not retried", r1.outcome === "contract-drift" && r1.httpStatus === 401 && server.requests.length === 1);
  check("401 log points at the secret without printing it", lines.some((l) => l.includes("authentication failed")));
  const r2 = await ingestor.submit("/api/ingest/obsidian", envelope);
  check("400 → contract-drift outcome, not retried", r2.outcome === "contract-drift" && r2.httpStatus === 400 && server.requests.length === 2);
  check("drift surfaced as error in logs", lines.some((l) => l.includes("contract drift")));
  await server.close();
}

console.log("5xx retry policy (3 retries, then stop):");
{
  const server = await startMockServer(() => ({ status: 500, body: { ok: false, error: "server_error" } }));
  const { ingestor, lines } = makeIngestor(server.url);
  const r = await ingestor.submit("/api/ingest/obsidian", envelope);
  check("persistent 5xx → unavailable", r.outcome === "unavailable", r);
  check("initial attempt + 3 retries = 4 requests", server.requests.length === 4, server.requests.length);
  check("gives up loudly", lines.some((l) => l.includes("unavailable after 3 retries")));
  await server.close();
}
{
  const server = await startMockServer((_, n) => (n < 3 ? { status: 503, body: {} } : { status: 200, body: { ok: true, status: "accepted" } }));
  const { ingestor } = makeIngestor(server.url);
  const r = await ingestor.submit("/api/ingest/obsidian", envelope);
  check("recovers when a retry succeeds", r.outcome === "success" && server.requests.length === 3);
  await server.close();
}

console.log("Network errors:");
{
  const server = await startMockServer(() => "destroy");
  const { ingestor } = makeIngestor(server.url);
  const r = await ingestor.submit("/api/ingest/obsidian", envelope);
  check("severed connection → unavailable after retries", r.outcome === "unavailable", r);
  await server.close();
}
{
  const dead = await startMockServer(() => ({ status: 200, body: {} }));
  await dead.close(); // port now refuses connections
  const { ingestor } = makeIngestor(dead.url);
  const r = await ingestor.submit("/api/ingest/obsidian", envelope);
  check("connection refused → unavailable after retries", r.outcome === "unavailable", r);
}

console.log("Secret absence (all flows above):");
check("secret never appears in any log line", allLines.every((l) => !l.includes(SECRET)));
check("logs were actually produced", allLines.length > 0, allLines.length);

summary("ingestor");
