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

summary("logger");
