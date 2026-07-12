#!/usr/bin/env node
/* Config loader tests (WS-2): mode-600 enforcement, secret non-serializability,
 * generic JSON errors, realpath normalization, defaults. */

import { mkdtemp, writeFile, chmod, mkdir, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, ConfigError } from "../config.mjs";
import { check, summary } from "./_helpers.mjs";

const dir = await mkdtemp(path.join(tmpdir(), "ws2-config-"));
const SECRET = "sk-super-secret-token-123";

const vaultReal = path.join(dir, "vault-real");
await mkdir(vaultReal);
const vaultLink = path.join(dir, "vault-link");
await symlink(vaultReal, vaultLink);

const base = {
  vaultPath: vaultLink,
  studioUrl: "https://studio.example.com/",
  syncSecret: SECRET,
  inboxPath: path.join(dir, "inbox"),
};

async function writeConfig(obj, mode = 0o600, name = "config.json") {
  const p = path.join(dir, name);
  await writeFile(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  await chmod(p, mode);
  return p;
}

console.log("Permission enforcement:");
for (const mode of [0o644, 0o640, 0o604, 0o660]) {
  const p = await writeConfig(base, mode, `config-${mode.toString(8)}.json`);
  try {
    await loadConfig({ configPath: p });
    check(`mode ${mode.toString(8)} refused`, false);
  } catch (e) {
    check(`mode ${mode.toString(8)} refused`, e instanceof ConfigError && e.code === "CONFIG_PERMISSIONS");
    check(`mode ${mode.toString(8)} error omits the secret`, !e.message.includes(SECRET));
  }
}

console.log("Valid config:");
const good = await writeConfig(base, 0o600);
const config = await loadConfig({ configPath: good });
check("mode 600 accepted", typeof config === "object");
check("vaultPath realpath-normalized (symlink resolved)", config.vaultPath === (await realpath(vaultReal)), config.vaultPath);
check("studioUrl trailing slash stripped", config.studioUrl === "https://studio.example.com");
check("defaults applied", config.debounceMs === 3000 && config.reconcileIntervalMs === 21600000 && config.watchGlob === "UXistentialism/**/*.md");
check("statusPath derived beside config", config.statusPath === path.join(dir, "status.json"));

console.log("Secret never serializable:");
check("syncSecret readable in-process", config.syncSecret === SECRET);
check("JSON.stringify omits the secret", !JSON.stringify(config).includes(SECRET));
check("Object.keys omits the secret", !Object.keys(config).includes("syncSecret"));
check("spread omits the secret", !("syncSecret" in { ...config }));
check("config is frozen", Object.isFrozen(config));

console.log("Failure modes:");
try {
  await loadConfig({ configPath: path.join(dir, "missing.json") });
  check("missing config refused", false);
} catch (e) {
  check("missing config refused with clear code", e.code === "CONFIG_MISSING");
}

const badJson = await writeConfig(`{"syncSecret": "${SECRET}", "oops`, 0o600, "bad.json");
try {
  await loadConfig({ configPath: badJson });
  check("malformed JSON refused", false);
} catch (e) {
  check("malformed JSON refused", e.code === "CONFIG_INVALID_JSON");
  check("parse error never quotes file content (secret-safe)", !e.message.includes(SECRET) && !e.message.includes("oops"));
}

const noVault = await writeConfig({ ...base, vaultPath: path.join(dir, "nope") }, 0o600, "novault.json");
try {
  await loadConfig({ configPath: noVault });
  check("nonexistent vaultPath refused", false);
} catch (e) {
  check("nonexistent vaultPath refused", e.code === "CONFIG_VAULT_PATH");
}

for (const field of ["vaultPath", "studioUrl", "syncSecret", "inboxPath"]) {
  const partial = { ...base };
  delete partial[field];
  const p = await writeConfig(partial, 0o600, `missing-${field}.json`);
  try {
    await loadConfig({ configPath: p });
    check(`missing ${field} refused`, false);
  } catch (e) {
    check(`missing ${field} refused`, e instanceof ConfigError);
  }
}

const badUrl = await writeConfig({ ...base, studioUrl: "ftp://x" }, 0o600, "badurl.json");
try {
  await loadConfig({ configPath: badUrl });
  check("non-http studioUrl refused", false);
} catch (e) {
  check("non-http studioUrl refused", e.code === "CONFIG_FIELD");
}

await rm(dir, { recursive: true, force: true });
summary("config");
