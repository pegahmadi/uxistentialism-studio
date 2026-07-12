// Strict validation matrix: envelope (§1, §12), Obsidian data (§2a), Editorial
// Board data (§2b incl. the v1 authority rules), public-safety scan (§5), and
// hash recomputation (§1b). Error messages must be redacted — they never echo
// offending content, paths, or secrets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { substantiveHash } from "../../tools/canonical-hash.mjs";
import { submit, envelope, obsidianData, boardData } from "./helpers.mjs";

const expect400 = async (payload, label, kind = "obsidian") => {
  const r = await submit({ kind, payload });
  assert.equal(r.status, 400, label);
  assert.equal(r.body.error, "invalid_schema", label);
  return r;
};

// ---------------------------------------------------------------- envelope

test("valid obsidian envelope → 200 accepted", async () => {
  const r = await submit({ payload: envelope(obsidianData()) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, status: "accepted" });
});

test("payload that is not an object → 400", async () => {
  for (const bodyText of ["[]", "42", '"x"', "null", "true"]) {
    const r = await submit({ bodyText });
    assert.equal(r.status, 400, bodyText);
  }
});

test("unknown top-level envelope field → 400", async () => {
  await expect400(envelope(obsidianData(), { extra: 1 }), "extra field");
});

test("each missing required envelope field → 400", async () => {
  for (const field of ["schemaVersion", "source", "sourceUpdatedAt", "projectedAt", "revision", "payloadHash", "data"]) {
    const p = envelope(obsidianData());
    delete p[field];
    await expect400(p, `missing ${field}`);
  }
});

test("schemaVersion must be exactly 1 (§12)", async () => {
  for (const v of [2, 0, -1, 1.5, "1", null, true]) {
    await expect400(envelope(obsidianData(), { schemaVersion: v }), `schemaVersion ${JSON.stringify(v)}`);
  }
});

test("source outside the §1 enum → 400; the endpoint-bound value passes (v1.1.2)", async () => {
  for (const v of ["vault", "COMPANION", "", 3]) {
    await expect400(envelope(obsidianData(), { source: v }), `source ${JSON.stringify(v)}`);
  }
  // In-enum values are bound per endpoint — full matrix in endpoint-binding.test.mjs.
  const r = await submit({ payload: envelope(obsidianData(), { source: "companion" }) });
  assert.equal(r.status, 200);
});

test("timestamps must be EXACT Date.toISOString() format (§1)", async () => {
  const bad = [
    "2026-07-12T10:30:00Z", // no milliseconds
    "2026-07-12T10:30:00.1Z", // 1-digit ms
    "2026-07-12T10:30:00.000+00:00", // offset instead of Z
    "2026-07-12 10:30:00.000Z",
    "2026-07-12",
    "not a date",
  ];
  for (const ts of bad) {
    await expect400(envelope(obsidianData(), { projectedAt: ts }), `projectedAt ${ts}`);
    await expect400(envelope(obsidianData(), { sourceUpdatedAt: ts }), `sourceUpdatedAt ${ts}`);
  }
  // Regex-shaped but not a real instant.
  await expect400(envelope(obsidianData(), { projectedAt: "2026-99-99T99:99:99.999Z" }), "impossible date");
});

test("revision must be an integer ≥ 1", async () => {
  for (const v of [0, -1, 1.5, "1", null]) {
    await expect400(envelope(obsidianData(), { revision: v }), `revision ${JSON.stringify(v)}`);
  }
});

test("payloadHash must be sha256-<64 hex>", async () => {
  for (const v of ["sha256-short", "md5-" + "a".repeat(64), "a".repeat(71), 7]) {
    await expect400(envelope(obsidianData(), { payloadHash: v }), `payloadHash ${JSON.stringify(v)}`);
  }
});

test("data must be an object", async () => {
  for (const v of [[], "x", 1, null]) {
    await expect400(envelope(obsidianData(), { data: v, payloadHash: "sha256-" + "a".repeat(64) }), `data ${JSON.stringify(v)}`);
  }
});

// ---------------------------------------------------------------- §2a data

const withData = (data) => envelope(data);

test("unknown field inside data → 400; a `source` field inside data is rejected", async () => {
  await expect400(withData(obsidianData({ extra: true })), "unknown data field");
  const r = await expect400(withData(obsidianData({ source: "vault" })), "source inside data");
  assert.match(r.body.message, /source/);
});

test("each missing §2a field → 400", async () => {
  for (const field of ["generatedAt", "concepts", "connections", "emerging"]) {
    const d = obsidianData();
    delete d[field];
    await expect400(withData(d), `missing data.${field}`);
  }
});

test("generatedAt must be exact ISO format", async () => {
  await expect400(withData(obsidianData({ generatedAt: "2026-07-12T10:30:05Z" })), "generatedAt");
});

test("empty concepts array → 400 (§2a)", async () => {
  await expect400(withData(obsidianData({ concepts: [] })), "empty concepts");
});

test("concept element: unknown / missing fields and wrong types → 400", async () => {
  const base = () => obsidianData().concepts[0];
  const cases = [
    { ...base(), path: "x" }, // unknown field (also a forbidden key)
    (() => { const c = base(); delete c.summary; return c; })(),
    { ...base(), title: 7 },
    { ...base(), presentIn: "today" },
    { ...base(), presentIn: ["today", 3] },
    { ...base(), backlinks: "3" },
    { ...base(), backlinks: null },
  ];
  for (const [i, c] of cases.entries()) {
    await expect400(withData(obsidianData({ concepts: [c] })), `concept case ${i}`);
  }
});

test("concept id must be slug-style: no spaces, no .md, no paths (§2a)", async () => {
  for (const id of ["has space", "note.md", "folder/note", "back\\slash", ""]) {
    const c = { ...obsidianData().concepts[0], id };
    await expect400(withData(obsidianData({ concepts: [c] })), `id ${JSON.stringify(id)}`);
  }
});

test("summary max 500 chars: 500 passes, 501 fails", async () => {
  const at = { ...obsidianData().concepts[0], summary: "s".repeat(500) };
  const over = { ...obsidianData().concepts[0], summary: "s".repeat(501) };
  const ok = await submit({ payload: withData(obsidianData({ concepts: [at] })) });
  assert.equal(ok.status, 200);
  await expect400(withData(obsidianData({ concepts: [over] })), "summary 501");
});

test("connections and emerging are validated strictly", async () => {
  await expect400(withData(obsidianData({ connections: [{ from: "a" }] })), "connection missing to");
  await expect400(withData(obsidianData({ connections: [{ from: "a", to: "b", weight: 1 }] })), "connection unknown field");
  await expect400(withData(obsidianData({ connections: "none" })), "connections not array");
  await expect400(withData(obsidianData({ emerging: [{ term: "x" }] })), "emerging missing references");
  await expect400(withData(obsidianData({ emerging: [{ term: "x", references: "2" }] })), "emerging references type");
});

// ------------------------------------------------------- §5 public safety

test("path-like strings anywhere in data → 400 with a REDACTED message", async () => {
  const leaky = { ...obsidianData().concepts[0], summary: "see /Users/pegah/vault/notes for detail" };
  const r = await expect400(withData(obsidianData({ concepts: [leaky] })), "path leak");
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes("/Users/pegah"), "must not echo the offending path");
  assert.match(r.body.message, /public-safety violation/);
  assert.match(r.body.message, /\$\.concepts\[0\]\.summary/);
});

test(".md fragments and file:// URIs are rejected; https URLs pass the scan", async () => {
  const md = { ...obsidianData().concepts[0], summary: "from Authority.md notes" };
  await expect400(withData(obsidianData({ concepts: [md] })), ".md fragment");
  const uri = { ...obsidianData().concepts[0], summary: "file:///anything" };
  await expect400(withData(obsidianData({ concepts: [uri] })), "file URI");
  const ok = { ...obsidianData().concepts[0], summary: "compare https://example.com/a/b and read/write splits 3/4" };
  const r = await submit({ payload: withData(obsidianData({ concepts: [ok] })) });
  assert.equal(r.status, 200);
});

// ---------------------------------------------------------------- §1b hash

test("asserted payloadHash that mismatches the recomputed substantive hash → 400", async () => {
  const data = obsidianData();
  const other = obsidianData({ emerging: [] });
  const r = await submit({ payload: envelope(data, { payloadHash: substantiveHash(other) }) });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid_schema");
  assert.match(r.body.message, /payloadHash/);
});

test("generatedAt-only change hashes identical (substantive-hash exception §1b)", async () => {
  const a = obsidianData({ generatedAt: "2026-07-12T00:00:00.000Z" });
  const b = obsidianData({ generatedAt: "2026-07-12T06:00:00.000Z" });
  assert.equal(substantiveHash(a), substantiveHash(b));
  // …and therefore an unchanged reprojection is idempotent end-to-end:
  const first = await submit({ payload: envelope(a) });
  assert.equal(first.body.status, "accepted");
  const second = await submit({
    redis: first.redis,
    payload: envelope(b, { revision: 2, projectedAt: "2026-07-12T06:00:01.000Z" }),
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.status, "idempotent");
});

// ---------------------------------------------------------------- §2b data

const boardEnv = (data, overrides = {}) => envelope(data, { source: "editorial-board-inbox", ...overrides });

test("valid editorial-board payload → 200 accepted", async () => {
  const r = await submit({ kind: "editorial-board", payload: boardEnv(boardData()) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, status: "accepted" });
});

test("non-empty rulings → 400 REGARDLESS of updatedBy (v1 authority rule)", async () => {
  for (const updatedBy of ["claude", "human"]) {
    const d = boardData({ rulings: [{ on: "the mechanism", decision: "keep it" }], updatedBy });
    const r = await expect400(boardEnv(d), `rulings with updatedBy=${updatedBy}`, "editorial-board");
    assert.match(r.body.message, /rulings/);
  }
});

test('manuscript.status "complete" → 400 REGARDLESS of updatedBy (v1 authority rule)', async () => {
  for (const updatedBy of ["claude", "human"]) {
    const d = boardData({ updatedBy });
    d.manuscript = { ...d.manuscript, status: "complete" };
    await expect400(boardEnv(d), `status complete with updatedBy=${updatedBy}`, "editorial-board");
  }
});

test('statuses "in review" and "awaiting ruling" are accepted; others rejected', async () => {
  for (const status of ["in review", "awaiting ruling"]) {
    const d = boardData();
    d.manuscript = { ...d.manuscript, status };
    const r = await submit({ kind: "editorial-board", payload: boardEnv(d) });
    assert.equal(r.status, 200, status);
  }
  for (const status of ["done", "COMPLETE", ""]) {
    const d = boardData();
    d.manuscript = { ...d.manuscript, status };
    await expect400(boardEnv(d), `status ${JSON.stringify(status)}`, "editorial-board");
  }
});

test("deferredThreads is rejected in submitted data (coordinator ruling)", async () => {
  await expect400(boardEnv(boardData({ deferredThreads: [] })), "deferredThreads", "editorial-board");
});

test("board field matrix → 400", async () => {
  const cases = [
    ["empty reviewers", boardData({ reviewers: [] })],
    ["reviewer unknown field", boardData({ reviewers: [{ ...boardData().reviewers[0], notes: "x" }] })],
    ["reviewer bad confidence", boardData({ reviewers: [{ ...boardData().reviewers[0], confidence: "sure" }] })],
    ["diagnosis over 500", boardData({ reviewers: [{ ...boardData().reviewers[0], diagnosis: "d".repeat(501) }] })],
    ["unresolvedQuestions item over 300", boardData({ unresolvedQuestions: ["q".repeat(301)] })],
    ["unresolvedQuestions non-string", boardData({ unresolvedQuestions: [7] })],
    ["nextDecision over 300", boardData({ nextDecision: "n".repeat(301) })],
    ["bad updatedBy", boardData({ updatedBy: "robot" })],
    ["bad reviewedAt", boardData({ reviewedAt: "2026-07-12T10:00:00Z" })],
    ["manuscript unknown field", (() => { const d = boardData(); d.manuscript = { ...d.manuscript, venue: "x" }; return d; })()],
    ["manuscript reviewRound type", (() => { const d = boardData(); d.manuscript = { ...d.manuscript, reviewRound: "3" }; return d; })()],
    ["unknown board field", boardData({ mood: "calm" })],
  ];
  for (const [label, d] of cases) {
    await expect400(boardEnv(d), label, "editorial-board");
  }
});

test("board transcript-like leak is rejected with a redacted message", async () => {
  const d = boardData({ reviewers: [{ ...boardData().reviewers[0], diagnosis: "see /home/pegah/transcripts today" }] });
  const r = await expect400(boardEnv(d), "board path leak", "editorial-board");
  assert.ok(!JSON.stringify(r.body).includes("/home/pegah"));
});
