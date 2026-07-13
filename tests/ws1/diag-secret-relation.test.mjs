// TEMPORARY — REMOVE AFTER GATE-5 SECRET DIAGNOSIS (reverted with the route).
//
// Proves the relation-only diagnostic: correct categories via the production
// comparison primitive; REAL-body rejection (streams without Content-Length,
// and misleading Content-Length: 0); identical generic empty 404 for every
// non-POST method; and that neither secret, meaningful substring, hash, nor
// numeric length appears in any response or captured application log.

import { test } from "node:test";
import assert from "node:assert/strict";
import { relationOf } from "../../lib/diag-secret-relation.mjs";
import * as route from "../../app/api/diag-secret-relation/route.ts";

const S = "synthetic-server-secret-0123456789abcdef"; // synthetic fixtures only
const hdr = (t) => `Bearer ${t}`;
const URL_ = "https://example.test/api/diag-secret-relation";

// ---- category logic (relationOf) — all four categories, parameterized ----

for (const [name, header, server, expected] of [
  ["exact", hdr(S), S, "exact"],
  ["server trailing newline", hdr(S), S + "\n", "server_trim_matches_local"],
  ["server surrounding spaces", hdr(S), ` ${S} `, "server_trim_matches_local"],
  ["local trailing whitespace", hdr(S + "  "), S, "local_trim_matches_server"],
  ["both differing whitespace", hdr(S + "\t"), ` ${S}`, "both_trim_match"],
  ["different values", hdr("completely-different-value-xxxxxxxxxxxxx"), S, "none"],
  ["same length different value", hdr(S.replace(/^s/, "z")), S, "none"],
  ["missing header", null, S, "none"],
  ["malformed header", "Token abc", S, "none"],
]) {
  test(`relationOf: ${name} → ${expected}`, () => assert.equal(relationOf(header, server), expected));
}
test("relationOf: absent server secret → unconfigured", () => {
  assert.equal(relationOf(hdr(S), undefined), "unconfigured");
  assert.equal(relationOf(hdr(S), ""), "unconfigured");
});

// ---- shared harness ----

function withEnv(value, fn) {
  const prev = process.env.STUDIO_SYNC_SECRET;
  if (value === undefined) delete process.env.STUDIO_SYNC_SECRET;
  else process.env.STUDIO_SYNC_SECRET = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.STUDIO_SYNC_SECRET;
    else process.env.STUDIO_SYNC_SECRET = prev;
  });
}

function captureConsole() {
  const lines = [];
  const orig = {};
  for (const m of ["log", "info", "warn", "error", "debug"]) {
    orig[m] = console[m];
    console[m] = (...a) => lines.push(a.map(String).join(" "));
  }
  return { lines, restore: () => Object.assign(console, orig) };
}

// Purity: no secret, no meaningful substring, no hash-like hex run, no numeric
// length (secret is 40 bytes; also check 64, the production length).
function assertPure(text, logs) {
  const all = text + "\n" + logs.join("\n");
  assert.ok(!all.includes(S), "secret leaked");
  assert.ok(!all.includes(S.slice(0, 12)), "secret prefix leaked");
  assert.ok(!all.includes(S.slice(-12)), "secret suffix leaked");
  assert.ok(!/[0-9a-f]{16,}/i.test(all), "hash-like hex leaked");
  assert.ok(!/\b(40|64|65)\b/.test(all), "length-like number leaked");
}

async function callPOST(request, env = S) {
  const cap = captureConsole();
  try {
    let res;
    await withEnv(env, async () => { res = await route.POST(request); });
    const text = await res.text();
    assertPure(text, cap.lines);
    assert.equal(cap.lines.length, 0, "route must log nothing");
    return { res, text };
  } finally { cap.restore(); }
}

const authOnly = (token) =>
  new Request(URL_, { method: "POST", headers: { authorization: hdr(token) } });

// ---- route: parameterized transport-reachable categories ----
// (local_trim / both_trim are unreachable at the route level: the Headers
// layer normalizes whitespace tails off header values before the wire — a
// diagnosis-relevant fact proven below; both categories stay covered at the
// relationOf layer above.)

for (const [name, env, expected] of [
  ["exact", S, '{"relation":"exact"}'],
  ["server_trim_matches_local (newline)", S + "\n", '{"relation":"server_trim_matches_local"}'],
  ["server_trim_matches_local (spaces)", ` ${S} `, '{"relation":"server_trim_matches_local"}'],
]) {
  test(`route: ${name} → exact static category`, async () => {
    const { res, text } = await callPOST(authOnly(S), env);
    assert.equal(res.status, 200);
    assert.equal(text, expected);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
}

test("route: transport normalizes a local whitespace tail (reads as exact)", async () => {
  const { res, text } = await callPOST(authOnly(S + " "), S);
  assert.equal(res.status, 200);
  assert.equal(text, '{"relation":"exact"}');
});

test("route: different values → generic empty 404", async () => {
  const { res, text } = await callPOST(authOnly("another-value-entirely-9876543210zzzzzz"), S);
  assert.equal(res.status, 404);
  assert.equal(text, "");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

// ---- route: REAL body rejection ----

test("route: streamed body WITHOUT Content-Length → generic empty 404 before comparison", async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{}")); c.close(); } });
  const request = new Request(URL_, {
    method: "POST",
    headers: { authorization: hdr(S) },
    body: stream,
    duplex: "half",
  });
  assert.equal(request.headers.get("content-length"), null, "precondition: no declared length");
  assert.notEqual(request.body, null, "precondition: body stream attached");
  const { res, text } = await callPOST(request, S);
  assert.equal(res.status, 404);
  assert.equal(text, "");
});

test("route: misleading Content-Length: 0 WITH an actual body → generic empty 404", async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{}")); c.close(); } });
  let request;
  try {
    request = new Request(URL_, {
      method: "POST",
      headers: { authorization: hdr(S), "content-length": "0" },
      body: stream,
      duplex: "half",
    });
  } catch {
    return; // runtime refuses to construct it — the bypass cannot exist here
  }
  assert.notEqual(request.body, null, "precondition: body stream attached");
  const { res, text } = await callPOST(request, S);
  assert.equal(res.status, 404);
  assert.equal(text, "");
});

test("route: declared non-zero Content-Length → generic empty 404 (defense in depth)", async () => {
  const request = new Request(URL_, {
    method: "POST",
    headers: { authorization: hdr(S), "content-length": "2" },
  });
  const { res, text } = await callPOST(request, S);
  assert.equal(res.status, 404);
  assert.equal(text, "");
});

// ---- route: every non-POST method → identical generic empty 404 ----

for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
  test(`route: ${method} → identical generic empty 404 + no-store`, async () => {
    const cap = captureConsole();
    try {
      const res = await route[method]();
      const text = await res.text();
      assert.equal(res.status, 404);
      assert.equal(text, "");
      assert.equal(res.headers.get("cache-control"), "no-store");
      assertPure(text, cap.lines);
      assert.equal(cap.lines.length, 0);
    } finally { cap.restore(); }
  });
}

// ---- route: absent server secret → static production misconfiguration body ----

test("route: server secret absent → static server_error body, nothing logged", async () => {
  const cap = captureConsole();
  try {
    let res;
    await withEnv(undefined, async () => { res = await route.POST(authOnly(S)); });
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.equal(text, '{"ok":false,"error":"server_error","message":"Server configuration error."}');
    assert.ok(!text.includes(S) && cap.lines.length === 0);
  } finally { cap.restore(); }
});
