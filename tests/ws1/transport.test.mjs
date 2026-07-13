// Transport gates (contract §4, §9): method, content-type, declared length,
// and ACTUAL-byte enforcement — including a lying Content-Length.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_BYTES } from "../../lib/ingest-core.mjs";
import { submit, envelope, obsidianData } from "./helpers.mjs";

const valid = () => envelope(obsidianData());

test("non-POST methods → 405 wrong_method", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const r = await submit({ payload: valid(), method });
    assert.equal(r.status, 405, method);
    assert.equal(r.body.error, "wrong_method");
  }
});

test("method is checked before content-type", async () => {
  const r = await submit({ payload: valid(), method: "GET", contentType: "text/plain" });
  assert.equal(r.status, 405);
});

test("missing content-type → 415 wrong_content_type", async () => {
  const r = await submit({ payload: valid(), contentType: null });
  assert.equal(r.status, 415);
  assert.equal(r.body.error, "wrong_content_type");
});

test("non-JSON content-type → 415", async () => {
  for (const ct of ["text/plain", "application/x-www-form-urlencoded", "application/json+ld"]) {
    const r = await submit({ payload: valid(), contentType: ct });
    assert.equal(r.status, 415, ct);
  }
});

test("application/json with charset parameter is accepted", async () => {
  const r = await submit({ payload: valid(), contentType: "application/json; charset=utf-8" });
  assert.equal(r.status, 200);
});

test("content-type is checked before content-length", async () => {
  const r = await submit({ payload: valid(), contentType: "text/plain", contentLength: null });
  assert.equal(r.status, 415);
});

test("missing Content-Length → 413 oversized", async () => {
  const r = await submit({ payload: valid(), contentLength: null });
  assert.equal(r.status, 413);
  assert.equal(r.body.error, "oversized");
});

test("malformed / negative Content-Length → 413", async () => {
  for (const cl of ["abc", "-5", "1.5", "12abc", ""]) {
    const r = await submit({ payload: valid(), contentLength: cl });
    assert.equal(r.status, 413, `content-length ${JSON.stringify(cl)}`);
    assert.equal(r.body.error, "oversized");
  }
});

test("declared Content-Length over 512KB → 413 before reading the body", async () => {
  const r = await submit({ payload: valid(), contentLength: String(MAX_BODY_BYTES + 1) });
  assert.equal(r.status, 413);
});

test("declared length is checked before auth", async () => {
  const r = await submit({ payload: valid(), contentLength: String(MAX_BODY_BYTES + 1), auth: "Bearer wrong" });
  assert.equal(r.status, 413);
});

test("actual bytes over 512KB with a LYING small Content-Length → 413", async () => {
  // Declares 10 bytes; actually streams > 512KB.
  const chunk = new Uint8Array(64 * 1024).fill(120); // 'x'
  const chunks = Array.from({ length: 9 }, () => chunk); // 576KB actual
  const r = await submit({ bodyChunks: chunks, contentLength: "10" });
  assert.equal(r.status, 413);
  assert.equal(r.body.error, "oversized");
});

test("actual-byte enforcement triggers even when declared length is exactly at the limit", async () => {
  const chunk = new Uint8Array(64 * 1024).fill(120);
  const chunks = Array.from({ length: 9 }, () => chunk); // 576KB actual
  const r = await submit({ bodyChunks: chunks, contentLength: String(MAX_BODY_BYTES) });
  assert.equal(r.status, 413);
});

test("large-but-legal body is read fully and proceeds to schema validation", async () => {
  const data = obsidianData({
    concepts: Array.from({ length: 500 }, (_, i) => ({
      id: `concept-${i}`,
      title: `Concept ${i}`,
      kind: "concept",
      category: "test",
      summary: "s".repeat(400),
      presentIn: ["field"],
      backlinks: i,
    })),
  });
  const r = await submit({ payload: envelope(data) });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "accepted");
});

test("body that is not valid JSON → 400 invalid_schema", async () => {
  const r = await submit({ bodyText: "{not json" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid_schema");
});
