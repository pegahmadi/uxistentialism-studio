#!/usr/bin/env node
/* Validator tests (WS-2): §2b mirror rejection matrix, inbox artifact wire
 * format, and the in-memory Obsidian validation bridge. */

import { rm } from "node:fs/promises";
import {
  validateEditorialBoardData,
  validateInboxArtifact,
  validateObsidianData,
} from "../validator.mjs";
import { check, summary, validBoardData, validArtifact, makeSyntheticVault } from "./_helpers.mjs";

const violationsFor = (mutate) => {
  const data = validBoardData();
  mutate(data);
  return validateEditorialBoardData(data);
};

console.log("§2b mirror — valid baseline:");
check("valid automated artifact passes", validateEditorialBoardData(validBoardData()).length === 0, validateEditorialBoardData(validBoardData()));
check('status "in review" passes', violationsFor((d) => (d.manuscript.status = "in review")).length === 0);

console.log("§2b mirror — authority rules (v1):");
let v = violationsFor((d) => (d.rulings = [{ on: "scope", decision: "approved" }]));
check("non-empty rulings rejected", v.some((m) => m.includes("rulings")));
v = violationsFor((d) => (d.manuscript.status = "complete"));
check('manuscript.status "complete" rejected', v.some((m) => m.includes("complete")));
v = violationsFor((d) => {
  d.manuscript.status = "complete";
  d.updatedBy = "human";
});
check('"complete" rejected even when updatedBy is human', v.some((m) => m.includes("complete")));
v = violationsFor((d) => {
  d.rulings = [{ on: "x", decision: "y" }];
  d.updatedBy = "human";
});
check("rulings rejected even when updatedBy is human", v.some((m) => m.includes("rulings")));

console.log("§2b mirror — unknown fields:");
check("unknown top-level field in data rejected", violationsFor((d) => (d.extra = 1)).some((m) => m.includes('unknown field "extra"')));
check("unknown manuscript field rejected", violationsFor((d) => (d.manuscript.venue = "x")).some((m) => m.includes('unknown field "venue"')));
check("unknown reviewer field rejected", violationsFor((d) => (d.reviewers[0].notes = "x")).some((m) => m.includes('unknown field "notes"')));

console.log("§2b mirror — required fields and types:");
check("missing manuscript rejected", violationsFor((d) => delete d.manuscript).some((m) => m.includes('missing required field "manuscript"')));
check("missing reviewers rejected", violationsFor((d) => delete d.reviewers).length > 0);
check("empty reviewers rejected", violationsFor((d) => (d.reviewers = [])).some((m) => m.includes("at least one")));
check("bad confidence rejected", violationsFor((d) => (d.reviewers[0].confidence = "certain")).some((m) => m.includes("confidence")));
check("bad updatedBy rejected", violationsFor((d) => (d.updatedBy = "agent")).some((m) => m.includes("updatedBy")));
check("bad status enum rejected", violationsFor((d) => (d.manuscript.status = "done")).some((m) => m.includes("status")));
check("non-string question rejected", violationsFor((d) => (d.unresolvedQuestions = [3])).length > 0);
check("non-array rulings rejected", violationsFor((d) => (d.rulings = "none")).some((m) => m.includes("rulings")));
check("non-object data rejected", validateEditorialBoardData([1, 2]).length > 0);

console.log("§2b mirror — max lengths:");
check("diagnosis > 500 rejected", violationsFor((d) => (d.reviewers[0].diagnosis = "x".repeat(501))).some((m) => m.includes("500")));
check("recommendation > 500 rejected", violationsFor((d) => (d.reviewers[0].recommendation = "x".repeat(501))).some((m) => m.includes("500")));
check("unresolvedQuestions entry > 300 rejected", violationsFor((d) => (d.unresolvedQuestions = ["x".repeat(301)])).some((m) => m.includes("300")));
check("nextDecision > 300 rejected", violationsFor((d) => (d.nextDecision = "x".repeat(301))).some((m) => m.includes("300")));
check("exactly-at-limit strings pass", violationsFor((d) => {
  d.reviewers[0].diagnosis = "x".repeat(500);
  d.nextDecision = "x".repeat(300);
}).length === 0);

console.log("§2b mirror — timestamps (§1 exact format + round-trip, FIX 9):");
check("reviewedAt without ms rejected", violationsFor((d) => (d.reviewedAt = "2026-07-12T18:04:07Z")).some((m) => m.includes("reviewedAt")));
check("updatedAt with offset rejected", violationsFor((d) => (d.updatedAt = "2026-07-12T18:04:07.123+00:00")).some((m) => m.includes("updatedAt")));
check("impossible reviewedAt date rejected (Feb 31)", violationsFor((d) => (d.reviewedAt = "2026-02-31T10:00:00.000Z")).some((m) => m.includes("reviewedAt")));
check("impossible updatedAt month rejected (month 13)", violationsFor((d) => (d.updatedAt = "2026-13-01T10:00:00.000Z")).some((m) => m.includes("updatedAt")));
check("valid leap-day accepted (2028-02-29)", violationsFor((d) => (d.reviewedAt = "2028-02-29T10:00:00.000Z")).length === 0);

console.log("§2b mirror — public-safety scan (§5, redacted):");
v = violationsFor((d) => (d.reviewers[0].diagnosis = "See /Users/pegah/notes/x for detail"));
check("path-like string rejected", v.some((m) => m.includes("path-like string")));
check("violation message never repeats the offending value", v.every((m) => !m.includes("/Users/pegah")));
check(".md fragment rejected", violationsFor((d) => (d.nextDecision = "revise thrownness.md")).some((m) => m.includes("path-like")));

console.log("Inbox artifact wire format (§2b):");
check("valid artifact passes", validateInboxArtifact(validArtifact()).length === 0, validateInboxArtifact(validArtifact()));
let a = validArtifact();
a.revision = 5;
check("extra top-level key rejected (data-only artifacts never carry envelope fields)", validateInboxArtifact(a).some((m) => m.includes('"revision"')));
a = validArtifact();
delete a.sourceUpdatedAt;
check("missing sourceUpdatedAt rejected (never mtime-substituted)", validateInboxArtifact(a).some((m) => m.includes("sourceUpdatedAt")));
a = validArtifact();
a.sourceUpdatedAt = "2026-07-12T18:04:07Z";
check("malformed sourceUpdatedAt rejected", validateInboxArtifact(a).some((m) => m.includes("sourceUpdatedAt")));
a = validArtifact();
a.sourceUpdatedAt = "2026-02-31T18:04:07.123Z";
check("impossible sourceUpdatedAt date rejected (FIX 9)", validateInboxArtifact(a).some((m) => m.includes("sourceUpdatedAt")));
a = validArtifact();
delete a.data;
check("missing data rejected", validateInboxArtifact(a).some((m) => m.includes("data")));
check("non-object artifact rejected", validateInboxArtifact("hi").length > 0);
a = validArtifact();
a.data.rulings = [{ on: "x", decision: "y" }];
check("artifact validation includes the §2b data rules", validateInboxArtifact(a).some((m) => m.includes("rulings")));

console.log("Obsidian in-memory bridge:");
const { root, allowlistPath } = await makeSyntheticVault();
try {
  const goodData = {
    generatedAt: "2026-07-12T10:00:00.000Z",
    concepts: [{ id: "alpha", title: "Alpha", kind: "core", category: "t", summary: "Fine.", presentIn: ["today"], backlinks: 2 }],
    connections: [{ from: "alpha", to: "beta" }],
    emerging: [{ term: "gamma missing", references: 1 }],
  };
  let r = await validateObsidianData({ data: goodData, vaultPath: root, allowlistPath });
  check("valid projection passes in memory (no temp files)", r.ok, r.violations);

  r = await validateObsidianData({
    data: { ...goodData, concepts: [{ ...goodData.concepts[0], summary: `See ${root}/alpha.md` }] },
    vaultPath: root,
    allowlistPath,
  });
  check("leaked vault path caught", !r.ok);
  check("leak violations are redacted", r.violations.every((m) => !m.includes(root)));

  r = await validateObsidianData({ data: { ...goodData, concepts: [] }, vaultPath: root, allowlistPath });
  check("empty concepts rejected (§2a)", !r.ok && r.violations.some((m) => m.includes("at least one")));

  r = await validateObsidianData({
    data: { ...goodData, concepts: [{ ...goodData.concepts[0], summary: "x".repeat(501) }] },
    vaultPath: root,
    allowlistPath,
  });
  check("summary > 500 rejected (§2a)", !r.ok && r.violations.some((m) => m.includes("500")));

  // FIX 8 — strict §2a: the shared validator's legacy tolerance for `source`
  // is NOT relied on; the strict mirror rejects it and every unknown field.
  r = await validateObsidianData({ data: { ...goodData, source: "companion" }, vaultPath: root, allowlistPath });
  check("data.source rejected by the strict §2a layer (FIX 8)", !r.ok && r.violations.some((m) => m.includes('"source"')), r.violations);

  r = await validateObsidianData({ data: { ...goodData, extra: 1 }, vaultPath: root, allowlistPath });
  check("unknown top-level field rejected", !r.ok && r.violations.some((m) => m.includes('"extra"')));

  r = await validateObsidianData({
    data: { ...goodData, concepts: [{ ...goodData.concepts[0], vaultKey: "alpha" }] },
    vaultPath: root,
    allowlistPath,
  });
  check("unknown concept field rejected at depth", !r.ok && r.violations.some((m) => m.includes('"vaultKey"')));

  r = await validateObsidianData({
    data: { ...goodData, connections: [{ from: "alpha", to: "beta", weight: 3 }] },
    vaultPath: root,
    allowlistPath,
  });
  check("unknown connection field rejected", !r.ok && r.violations.some((m) => m.includes('"weight"')));

  r = await validateObsidianData({
    data: { ...goodData, emerging: [{ term: "gamma missing", references: 1, note: "x" }] },
    vaultPath: root,
    allowlistPath,
  });
  check("unknown emerging field rejected", !r.ok && r.violations.some((m) => m.includes('"note"')));

  {
    const missingField = { ...goodData };
    delete missingField.connections;
    r = await validateObsidianData({ data: missingField, vaultPath: root, allowlistPath });
    check("missing required §2a field rejected", !r.ok && r.violations.some((m) => m.includes('"connections"')));
  }

  r = await validateObsidianData({
    data: { ...goodData, concepts: [{ ...goodData.concepts[0], backlinks: "2" }] },
    vaultPath: root,
    allowlistPath,
  });
  check("wrong §2a field type rejected (backlinks string)", !r.ok && r.violations.some((m) => m.includes("backlinks")));

  r = await validateObsidianData({
    data: { ...goodData, generatedAt: "2026-02-31T10:00:00.000Z" },
    vaultPath: root,
    allowlistPath,
  });
  check("impossible generatedAt rejected (FIX 9)", !r.ok && r.violations.some((m) => m.includes("generatedAt")));

  r = await validateObsidianData({
    data: { ...goodData, concepts: [{ ...goodData.concepts[0], id: "not-allowlisted" }] },
    vaultPath: root,
    allowlistPath,
  });
  check("non-allowlisted concept id rejected", !r.ok);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(allowlistPath, { force: true });
}

summary("validator");
