#!/usr/bin/env node
/*
 * Locks the §1b reference implementation (tools/canonical-hash.mjs).
 *
 * The critical property: payloadHash is the identity of the SUBSTANTIVE
 * projection — identical concepts/connections/emerging with different
 * generatedAt values produce identical hashes.
 *
 * Portable: no Redis, no vault, no config.
 * Usage: node tools/tests/canonical-hash.test.mjs
 */

import { canonicalize, substantiveHash } from "../canonical-hash.mjs";

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`); }
}

const substantive = {
  concepts: [
    { id: "alpha", title: "Alpha", kind: "core", category: "test", summary: "A.", presentIn: ["today"], backlinks: 2 },
    { id: "beta", title: "Beta", kind: "concept", category: "test", summary: "B.", presentIn: ["field"], backlinks: 1 },
  ],
  connections: [{ from: "alpha", to: "beta" }],
  emerging: [{ term: "gamma missing", references: 1 }],
};

console.log("Substantive-hash exception (the blocker's core property):");
const run1 = { generatedAt: "2026-07-12T00:00:00.000Z", ...substantive };
const run2 = { generatedAt: "2026-07-12T06:00:00.000Z", ...substantive };
check("identical substance + different generatedAt → identical hash", substantiveHash(run1) === substantiveHash(run2));
check("hash has sha256- prefix + 64 hex chars", /^sha256-[0-9a-f]{64}$/.test(substantiveHash(run1)), substantiveHash(run1));

const changed = { ...run1, concepts: [...substantive.concepts, { id: "delta", title: "Delta", kind: "concept", category: "test", summary: "D.", presentIn: [], backlinks: 0 }] };
check("substantive change → different hash", substantiveHash(run1) !== substantiveHash(changed));

const nested = { generatedAt: "2026-07-12T00:00:00.000Z", concepts: [], connections: [], emerging: [], manuscript: { generatedAt: "X" } };
const nested2 = { ...nested, manuscript: { generatedAt: "Y" } };
check("only TOP-LEVEL generatedAt excluded — nested one still hashed", substantiveHash(nested) !== substantiveHash(nested2));

console.log("Canonicalization rules:");
check("object key order irrelevant", canonicalize({ b: 1, a: 2 }) === canonicalize({ a: 2, b: 1 }));
check("recursive key sorting", canonicalize({ x: { b: 1, a: 2 } }) === '{"x":{"a":2,"b":1}}');
check("array order retained (order-sensitive)", canonicalize([1, 2]) !== canonicalize([2, 1]));
check("no insignificant whitespace", canonicalize({ a: [1, "s"] }) === '{"a":[1,"s"]}');
check("JSON.stringify scalar semantics", canonicalize({ n: 1e21, s: "q\"uote", b: false, z: null }) === '{"b":false,"n":1e+21,"s":"q\\"uote","z":null}');

console.log("Non-JSON values throw (→ invalid_schema before hashing):");
for (const [label, v] of [["undefined property", { a: undefined }], ["NaN", { a: NaN }], ["Infinity", { a: Infinity }], ["function", { a: () => {} }], ["BigInt", { a: 1n }]]) {
  try { canonicalize(v); check(`${label} throws`, false); }
  catch (e) { check(`${label} throws`, e instanceof TypeError); }
}
const circ = { a: {} }; circ.a.self = circ;
try { canonicalize(circ); check("circular reference throws", false); }
catch (e) { check("circular reference throws", e instanceof TypeError); }

console.log(`\n${fail === 0 ? "✓ ALL PASS" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
