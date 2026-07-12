#!/usr/bin/env node
/* Debounce + single-flight queue tests (WS-2). Uses short real timers. */

import { createDebouncedSingleFlight } from "../vault-watcher.mjs";
import { check, summary, sleep } from "./_helpers.mjs";

console.log("Debounce collapses rapid events:");
{
  let runs = 0;
  const runner = createDebouncedSingleFlight({ debounceMs: 40, run: async () => (runs += 1) });
  for (let i = 0; i < 6; i++) {
    runner.trigger();
    await sleep(5);
  }
  await sleep(120);
  check("many rapid triggers → exactly one run", runs === 1, runs);
  runner.trigger();
  await sleep(80);
  check("a later trigger runs again", runs === 2, runs);
  runner.close();
}

console.log("Single-flight queue:");
{
  let runs = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  const runner = createDebouncedSingleFlight({
    debounceMs: 10,
    run: async () => {
      runs += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(60);
      concurrent -= 1;
    },
  });
  runner.trigger();
  await sleep(25); // first run is now in flight
  runner.trigger(); // three triggers DURING the run…
  runner.trigger();
  await sleep(5);
  runner.trigger();
  await sleep(250);
  check("triggers during a run collapse into exactly one queued follow-up", runs === 2, runs);
  check("never more than one sync in flight", maxConcurrent === 1, maxConcurrent);
  runner.close();
}

console.log("runNow bypasses the debounce:");
{
  let runs = 0;
  const runner = createDebouncedSingleFlight({ debounceMs: 5000, run: async () => (runs += 1) });
  runner.trigger(); // would fire in 5s
  await runner.runNow();
  check("runNow executes immediately", runs === 1, runs);
  await sleep(30);
  check("runNow cancels the pending debounce timer", runs === 1, runs);
  runner.close();
}

console.log("runNow during a run queues (still single-flight):");
{
  let runs = 0;
  const runner = createDebouncedSingleFlight({
    debounceMs: 10,
    run: async () => {
      runs += 1;
      await sleep(50);
    },
  });
  const first = runner.runNow();
  await sleep(10);
  void runner.runNow(); // during flight → queued
  await first;
  await sleep(120);
  check("runNow during run produces exactly one follow-up", runs === 2, runs);
  runner.close();
}

console.log("Errors do not break the loop:");
{
  let runs = 0;
  const lines = [];
  const runner = createDebouncedSingleFlight({
    debounceMs: 10,
    run: async () => {
      runs += 1;
      if (runs === 1) throw new Error("boom");
    },
    logger: { error: (m) => lines.push(m) },
  });
  await runner.runNow();
  check("error logged", lines.some((l) => l.includes("boom")));
  await runner.runNow();
  check("runner keeps working after a failed run", runs === 2, runs);
  runner.close();
}

summary("debounce");
