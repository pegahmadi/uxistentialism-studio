#!/usr/bin/env node
/* Envelope tests (WS-2): §1 shape, §1b hash parity with the shared reference
 * implementation, generatedAt exclusion, JSON-safety guard. */

import { substantiveHash } from "../../tools/canonical-hash.mjs";
import { buildEnvelope } from "../envelope.mjs";
import { check, summary } from "./_helpers.mjs";

const data = {
  generatedAt: "2026-07-12T10:00:00.000Z",
  concepts: [{ id: "alpha", title: "Alpha", kind: "core", category: "t", summary: "s", presentIn: ["today"], backlinks: 2 }],
  connections: [{ from: "alpha", to: "beta" }],
  emerging: [{ term: "gamma", references: 1 }],
};

console.log("Envelope shape (§1):");
const env = buildEnvelope({ source: "companion", sourceUpdatedAt: "2026-07-12T09:59:00.000Z", data, revision: 7, now: Date.parse("2026-07-12T10:00:05.123Z") });
check("exact field set", JSON.stringify(Object.keys(env).sort()) === JSON.stringify(["data", "payloadHash", "projectedAt", "revision", "schemaVersion", "source", "sourceUpdatedAt"]), Object.keys(env));
check("schemaVersion 1", env.schemaVersion === 1);
check("projectedAt exact toISOString", env.projectedAt === "2026-07-12T10:00:05.123Z");
check("revision passthrough", env.revision === 7);
check("hash matches the shared reference implementation", env.payloadHash === substantiveHash(data));
check("hash has sha256- prefix", /^sha256-[0-9a-f]{64}$/.test(env.payloadHash));

console.log("Hash parity (§1b substantive-hash exception):");
const reprojected = { ...data, generatedAt: "2026-07-12T16:00:00.000Z" }; // ONLY generatedAt changed
const env2 = buildEnvelope({ source: "companion", sourceUpdatedAt: "2026-07-12T09:59:00.000Z", data: reprojected, revision: 8 });
check("generatedAt-only change → identical payloadHash", env2.payloadHash === env.payloadHash);
const substantive = { ...data, emerging: [{ term: "gamma", references: 2 }] };
check("substantive change → different hash", buildEnvelope({ source: "companion", sourceUpdatedAt: "2026-07-12T09:59:00.000Z", data: substantive, revision: 8 }).payloadHash !== env.payloadHash);
const nested = { ...data, concepts: [{ ...data.concepts[0], generatedAt: "x" }] };
check("nested generatedAt IS hashed (top-level-only exclusion)", buildEnvelope({ source: "companion", sourceUpdatedAt: "2026-07-12T09:59:00.000Z", data: nested, revision: 8 }).payloadHash !== env.payloadHash);

console.log("JSON-safety guard (§1b — rejected BEFORE serialization):");
const bads = [
  ["undefined value", { ...data, x: undefined }],
  ["NaN", { ...data, x: NaN }],
  ["Infinity", { ...data, x: Infinity }],
  ["-Infinity", { ...data, x: -Infinity }],
  ["function", { ...data, x: () => {} }],
  ["BigInt", { ...data, x: 1n }],
];
const circular = { ...data };
circular.self = circular;
bads.push(["circular reference", circular]);
for (const [name, bad] of bads) {
  try {
    buildEnvelope({ source: "companion", sourceUpdatedAt: "2026-07-12T09:59:00.000Z", data: bad, revision: 1 });
    check(`${name} rejected`, false);
  } catch (e) {
    check(`${name} rejected`, e instanceof TypeError);
  }
}

console.log("Envelope input validation:");
try {
  buildEnvelope({ source: "studio-ui", sourceUpdatedAt: "2026-07-12T09:59:00.000Z", data, revision: 1 });
  check("companion never claims studio-ui source", false);
} catch {
  check("companion never claims studio-ui source", true);
}
for (const badIso of ["2026-07-12T09:59:00Z", "2026-07-12 09:59:00.000Z", "2026-07-12T09:59:00.000+00:00", null]) {
  try {
    buildEnvelope({ source: "companion", sourceUpdatedAt: badIso, data, revision: 1 });
    check(`non-exact ISO rejected (${badIso})`, false);
  } catch {
    check(`non-exact ISO rejected (${badIso})`, true);
  }
}
for (const badRev of [0, -1, 1.5, "1", null]) {
  try {
    buildEnvelope({ source: "companion", sourceUpdatedAt: "2026-07-12T09:59:00.000Z", data, revision: badRev });
    check(`revision ${JSON.stringify(badRev)} rejected`, false);
  } catch {
    check(`revision ${JSON.stringify(badRev)} rejected`, true);
  }
}

summary("envelope");
