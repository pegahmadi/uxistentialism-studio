#!/usr/bin/env node
/* Zero-dependency test runner (WS-2): runs every *.test.mjs in this directory
 * sequentially and exits non-zero if any suite fails. */

import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = (await readdir(here)).filter((n) => n.endsWith(".test.mjs")).sort();

let failed = 0;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, suite)], { stdio: "inherit" });
    child.on("close", resolve);
  });
  if (code !== 0) failed += 1;
}

console.log(`\n${failed === 0 ? "✓" : "✗"} ${suites.length} suites, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
