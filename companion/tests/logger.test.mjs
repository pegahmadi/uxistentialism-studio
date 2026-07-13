#!/usr/bin/env node
/* Redacting logger tests (WS-2). */

import { createLogger } from "../logger.mjs";
import { check, summary } from "./_helpers.mjs";

const SECRET = "sk-super-secret-token-123";
const VAULT = "/Users/someone/Desktop/Vault";

const lines = [];
const logger = createLogger({
  redactions: [
    [SECRET, "[redacted-secret]"],
    [VAULT, "[vault]"],
    ["/Users/someone", "~"],
  ],
  sink: (line) => lines.push(line),
});

console.log("Redaction:");
logger.info(`posting with Authorization: Bearer ${SECRET}`);
check("secret never appears", !lines.some((l) => l.includes(SECRET)));
check("secret replaced with placeholder", lines.at(-1).includes("[redacted-secret]"));

logger.error(`could not read ${VAULT}/note.md`);
check("vault path redacted", !lines.some((l) => l.includes(VAULT)));

logger.warn(`config at /Users/someone/.config/x.json`);
check("home dir redacted (prefix of vault path handled by longest-first order)", lines.at(-1).includes("~/.config/x.json"));

console.log("Object safety:");
logger.info("config is", { syncSecret: SECRET, vaultPath: VAULT });
check("objects are never serialized", lines.at(-1).includes("[unloggable object]") && !lines.at(-1).includes(SECRET));

const err = new Error(`boom near ${SECRET}`);
logger.error(err);
check("errors log message only (redacted)", lines.at(-1).includes("boom near [redacted-secret]"));
check("no stack traces in logs", !lines.some((l) => l.includes("    at ")));

logger.info("count:", 42, true, null, undefined);
check("scalars render plainly", lines.at(-1).includes("count: 42 true null undefined"));

console.log("Note-path scrub (FIX 12): no .md fragment survives, even post-redaction:");
logger.error(`watcher error: ${VAULT}/Private Note.md`);
check("vault-prefixed note with a SPACE in its name fully scrubbed", !lines.at(-1).includes("Private") && !lines.at(-1).includes(".md"), lines.at(-1));
check("scrub placeholder present", lines.at(-1).includes("[note]"));

logger.error("ENOENT: no such file, open 'thrownness.md'");
check("bare .md filename scrubbed", !lines.at(-1).includes("thrownness.md"), lines.at(-1));

logger.error("failed on /Users/someone/other/Deep Dive Note.md mid-sync");
check("unredacted absolute note path scrubbed", !lines.at(-1).includes("Deep Dive") && !lines.at(-1).includes(".md"), lines.at(-1));

const fsError = new Error(`EACCES: permission denied, open '${VAULT}/03 Products/Secret Roadmap.md'`);
logger.error(fsError);
check("Error object with an embedded note path scrubbed", !lines.at(-1).includes("Roadmap") && !lines.at(-1).includes(".md"), lines.at(-1));

logger.info("inbox artifact#a1b2c3d4 submitted (accepted) and removed");
check("opaque artifact labels pass through untouched", lines.at(-1).includes("artifact#a1b2c3d4"));

check("no .md fragment anywhere in the captured log", lines.every((l) => !l.includes(".md")), lines.filter((l) => l.includes(".md")));

summary("logger");
