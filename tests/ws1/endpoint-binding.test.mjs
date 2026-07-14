// Endpoint source binding + automated provenance binding (contract v1.1.2).
//
// Each ingestion endpoint accepts exactly ONE envelope source:
//   /api/ingest/obsidian        → "companion"
//   /api/ingest/editorial-board → "editorial-board-inbox"
// ("studio-ui" is in the §1 enum but reserved for WS-4 — no ingestion endpoint
// here accepts it.)
//
// The automated board path additionally binds provenance: data.updatedBy must
// be "claude" (asserted human provenance through the automated path is
// forbidden) and data.sourceLabel must be exactly the automated board label.

import { test } from "node:test";
import assert from "node:assert/strict";
import { BOARD_SOURCE_LABEL } from "../../lib/ingest-core.mjs";
import { submit, envelope, obsidianData, boardData } from "./helpers.mjs";

const boardEnv = (data, overrides = {}) => envelope(data, { source: "editorial-board-inbox", ...overrides });

const expect400 = async (kind, payload, label) => {
  const r = await submit({ kind, payload });
  assert.equal(r.status, 400, label);
  assert.equal(r.body.error, "invalid_schema", label);
  return r;
};

// ------------------------------------------------------- source binding

test('obsidian endpoint: source "companion" → 200 accepted', async () => {
  const r = await submit({ payload: envelope(obsidianData(), { source: "companion" }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "accepted");
});

test("obsidian endpoint: every other in-enum source → 400 invalid_schema", async () => {
  for (const source of ["editorial-board-inbox", "studio-ui"]) {
    const r = await expect400("obsidian", envelope(obsidianData(), { source }), `obsidian source ${source}`);
    assert.match(r.body.message, /\$\.source/);
  }
});

test('editorial-board endpoint: source "editorial-board-inbox" → 200 accepted', async () => {
  const r = await submit({ kind: "editorial-board", payload: boardEnv(boardData()) });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "accepted");
});

test("editorial-board endpoint: every other in-enum source → 400 invalid_schema", async () => {
  for (const source of ["companion", "studio-ui"]) {
    const r = await expect400("editorial-board", boardEnv(boardData(), { source }), `board source ${source}`);
    assert.match(r.body.message, /\$\.source/);
  }
});

// -------------------------------------------------- provenance binding (§2b)

test('editorial-board: updatedBy "human" → 400 (asserted human provenance via the automated path is forbidden)', async () => {
  const r = await expect400("editorial-board", boardEnv(boardData({ updatedBy: "human" })), "updatedBy human");
  assert.match(r.body.message, /\$\.data\.updatedBy/);
});

test("editorial-board: updatedBy outside the enum → 400", async () => {
  for (const updatedBy of ["robot", "", "CLAUDE", 7]) {
    await expect400("editorial-board", boardEnv(boardData({ updatedBy })), `updatedBy ${JSON.stringify(updatedBy)}`);
  }
});

test("editorial-board: sourceLabel must be exactly the automated board label", async () => {
  assert.equal(BOARD_SOURCE_LABEL, "Claude Editorial Board · automated");
  for (const sourceLabel of [
    "Claude Editorial Board",
    "claude editorial board · automated",
    "Claude Editorial Board - automated", // hyphen instead of middle dot
    "Claude Editorial Board · automated ", // trailing space
    "",
    7,
  ]) {
    const r = await expect400("editorial-board", boardEnv(boardData({ sourceLabel })), `sourceLabel ${JSON.stringify(sourceLabel)}`);
    assert.match(r.body.message, /\$\.data\.sourceLabel/);
  }
});

test('editorial-board: updatedBy "claude" + exact automated label → 200 accepted', async () => {
  const r = await submit({
    kind: "editorial-board",
    payload: boardEnv(boardData({ updatedBy: "claude", sourceLabel: BOARD_SOURCE_LABEL })),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "accepted");
});

test("binding rejections never echo the offending value", async () => {
  const r = await expect400("editorial-board", boardEnv(boardData({ sourceLabel: "Totally Forged Label xyzzy" })), "forged label");
  assert.ok(!JSON.stringify(r.body).includes("xyzzy"), "offending content must not be echoed");
});
