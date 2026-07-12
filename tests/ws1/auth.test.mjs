// Authentication contract (§3): 500 when the secret is unset (never a silent
// bypass), length-safe constant-time comparison (unequal-length tokens must not
// throw), identical 401s for every credential failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAuth } from "../../lib/ingest-core.mjs";
import { submit, envelope, obsidianData, SECRET } from "./helpers.mjs";

const valid = () => envelope(obsidianData());

test("secret absent on server → 500 server_error, not a bypass", async () => {
  for (const secret of [undefined, ""]) {
    const r = await submit({ payload: valid(), secret, auth: `Bearer ${SECRET}` });
    assert.equal(r.status, 500, String(secret));
    assert.equal(r.body.error, "server_error");
    assert.ok(!JSON.stringify(r.body).includes(SECRET), "secret must never appear in a response");
  }
});

test("missing Authorization header → 401 auth_failed", async () => {
  const r = await submit({ payload: valid(), auth: null });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "auth_failed");
});

test("malformed Authorization headers → 401", async () => {
  for (const auth of ["Token abc", "Bearer", "Bearer ", `bearer ${SECRET}`, SECRET, `Basic ${SECRET}`]) {
    const r = await submit({ payload: valid(), auth });
    assert.equal(r.status, 401, JSON.stringify(auth));
    assert.equal(r.body.error, "auth_failed");
  }
});

test("wrong token of EQUAL length → 401", async () => {
  const wrong = "x".repeat(SECRET.length);
  const r = await submit({ payload: valid(), auth: `Bearer ${wrong}` });
  assert.equal(r.status, 401);
});

test("wrong tokens of UNEQUAL length → 401 without throwing (length-safe)", async () => {
  for (const wrong of ["a", SECRET.slice(0, -1), SECRET + "x", "x".repeat(300)]) {
    const r = await submit({ payload: valid(), auth: `Bearer ${wrong}` });
    assert.equal(r.status, 401, `token length ${wrong.length}`);
    assert.equal(r.body.error, "auth_failed");
  }
});

test("token that PREFIXES the secret is rejected", async () => {
  const r = await submit({ payload: valid(), auth: `Bearer ${SECRET.slice(0, 8)}` });
  assert.equal(r.status, 401);
});

test("every credential failure returns the identical 401 body", async () => {
  const failures = [null, "Token abc", `Bearer ${"x".repeat(SECRET.length)}`, "Bearer a", `Bearer ${SECRET}x`];
  const bodies = [];
  for (const auth of failures) {
    const r = await submit({ payload: valid(), auth });
    assert.equal(r.status, 401);
    bodies.push(r.body);
  }
  for (const b of bodies) assert.deepEqual(b, bodies[0]);
});

test("correct token → pipeline proceeds", async () => {
  const r = await submit({ payload: valid() });
  assert.equal(r.status, 200);
});

test("auth failure never echoes the secret or the presented token", async () => {
  const r = await submit({ payload: valid(), auth: "Bearer super-private-guess" });
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes("super-private-guess"));
  assert.ok(!text.includes(SECRET));
});

test("checkAuth unit: unequal-length buffers never reach timingSafeEqual mixed", () => {
  // Direct unit coverage of the length-safe branch (would throw otherwise).
  assert.equal(checkAuth("Bearer ab", "a-much-longer-secret-value"), "unauthorized");
  assert.equal(checkAuth("Bearer " + "x".repeat(4096), "short"), "unauthorized");
  assert.equal(checkAuth(null, "secret"), "unauthorized");
  assert.equal(checkAuth("Bearer secret", "secret"), "ok");
  assert.equal(checkAuth("Bearer secret", undefined), "unconfigured");
  assert.equal(checkAuth("Bearer secret", ""), "unconfigured");
});
