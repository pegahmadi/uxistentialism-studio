// TEMPORARY — REMOVE AFTER GATE-5 SECRET DIAGNOSIS (reverted with the route).
//
// Proves the relation-only diagnostic: correct categories via the production
// comparison primitive, generic 404 concealment, static misconfiguration body,
// and that neither secret nor any substring/hash/length ever appears in
// responses or captured logs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { relationOf } from "../../lib/diag-secret-relation.mjs";
import { POST, GET } from "../../app/api/diag-secret-relation/route.ts";

const S = "synthetic-server-secret-0123456789abcdef"; // synthetic fixtures only
const hdr = (t) => `Bearer ${t}`;

// ---- category logic (relationOf) ----

test("exact", () => assert.equal(relationOf(hdr(S), S), "exact"));
test("server trailing newline → server_trim_matches_local", () =>
  assert.equal(relationOf(hdr(S), S + "\n"), "server_trim_matches_local"));
test("server surrounding spaces → server_trim_matches_local", () =>
  assert.equal(relationOf(hdr(S), ` ${S} `), "server_trim_matches_local"));
test("local trailing whitespace → local_trim_matches_server", () =>
  assert.equal(relationOf(hdr(S + "  "), S), "local_trim_matches_server"));
test("both sides differing whitespace → both_trim_match", () =>
  assert.equal(relationOf(hdr(S + "\t"), ` ${S}`), "both_trim_match"));
test("different values → none", () =>
  assert.equal(relationOf(hdr("completely-different-value-xxxxxxxxxxxxx"), S), "none"));
test("same length different value → none", () =>
  assert.equal(relationOf(hdr(S.replace(/^s/, "z")), S), "none"));
test("missing header → none", () => assert.equal(relationOf(null, S), "none"));
test("malformed header → none", () => assert.equal(relationOf("Token abc", S), "none"));
test("absent server secret → unconfigured", () => {
  assert.equal(relationOf(hdr(S), undefined), "unconfigured");
  assert.equal(relationOf(hdr(S), ""), "unconfigured");
});

// ---- route behavior + purity ----

function req({ auth, body, method = "POST" } = {}) {
  const headers = new Headers();
  if (auth) headers.set("authorization", auth);
  if (body) headers.set("content-length", String(body.length));
  return new Request("https://example.test/api/diag-secret-relation", { method, headers });
}

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
  for (const m of ["log", "info", "warn", "error"]) {
    orig[m] = console[m];
    console[m] = (...a) => lines.push(a.join(" "));
  }
  return { lines, restore: () => Object.assign(console, orig) };
}

test("route: exact relation returns static category, nothing logged, no secret material", async () => {
  const cap = captureConsole();
  try {
    await withEnv(S, async () => {
      const res = await POST(req({ auth: hdr(S) }));
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.equal(text, '{"relation":"exact"}');
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.ok(!text.includes(S) && !text.includes(S.slice(0, 12)) && !/\b\d{2,}\b/.test(text),
        "no secret substrings/lengths in response");
      assert.equal(cap.lines.length, 0, "route logs nothing");
      assert.ok(!cap.lines.join(" ").includes(S));
    });
  } finally { cap.restore(); }
});

test("route: whitespace categories surface correctly", async () => {
  await withEnv(S + "\n", async () => {
    const res = await POST(req({ auth: hdr(S) }));
    assert.equal(await res.text(), '{"relation":"server_trim_matches_local"}');
  });
  // NOTE: at the ROUTE level a local whitespace tail is unreachable — the
  // fetch Headers layer normalizes leading/trailing HTTP whitespace off header
  // values before the server ever sees them (so the wire presents the trimmed
  // token and the relation reads "exact"). This is a diagnosis-relevant fact:
  // local-side whitespace cannot cause the production 401. The
  // local_trim_matches_server category remains covered at the logic layer
  // (relationOf unit test above) for non-transport callers.
  await withEnv(S, async () => {
    const res = await POST(req({ auth: hdr(S + " ") }));
    assert.equal(await res.text(), '{"relation":"exact"}');
  });
});

test("route: different values → generic empty 404", async () => {
  await withEnv(S, async () => {
    const res = await POST(req({ auth: hdr("another-value-entirely-9876543210zzzzzz") }));
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "");
  });
});

test("route: request body present → generic 404 (no body accepted)", async () => {
  await withEnv(S, async () => {
    const res = await POST(req({ auth: hdr(S), body: "{}" }));
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "");
  });
});

test("route: GET → generic 404", async () => {
  await withEnv(S, async () => {
    const res = await GET();
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "");
  });
});

test("route: server secret absent → static production misconfiguration body", async () => {
  await withEnv(undefined, async () => {
    const res = await POST(req({ auth: hdr(S) }));
    assert.equal(res.status, 500);
    assert.equal(await res.text(), '{"ok":false,"error":"server_error","message":"Server configuration error."}');
  });
});
