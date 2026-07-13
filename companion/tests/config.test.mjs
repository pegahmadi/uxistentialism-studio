#!/usr/bin/env node
/* Config loader tests (WS-2): mode-600 enforcement, secret non-serializability,
 * generic JSON errors, realpath normalization, defaults, read-only vault
 * boundary (FIX 6), and studioUrl HTTPS enforcement (FIX 11). */

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
check(
  "defaults applied (watchGlob **/*.md — FIX 5; requestTimeoutMs 30000 — FIX 10)",
  config.debounceMs === 3000 &&
    config.reconcileIntervalMs === 21600000 &&
    config.watchGlob === "**/*.md" &&
    config.requestTimeoutMs === 30000,
  { watchGlob: config.watchGlob, requestTimeoutMs: config.requestTimeoutMs },
);
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

console.log("studioUrl HTTPS enforcement (FIX 11):");
async function tryUrl(studioUrl, name) {
  const p = await writeConfig({ ...base, studioUrl }, 0o600, name);
  try {
    return { ok: true, config: await loadConfig({ configPath: p }) };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  }
}
let u = await tryUrl("https://studio.example.com", "url-https.json");
check("https non-loopback accepted", u.ok);
u = await tryUrl("http://localhost:3000", "url-localhost.json");
check("http + localhost accepted (local dev)", u.ok, u.code);
u = await tryUrl("http://127.0.0.1:8080", "url-loopv4.json");
check("http + 127.0.0.1 accepted", u.ok, u.code);
u = await tryUrl("http://[::1]:8080", "url-loopv6.json");
check("http + [::1] accepted", u.ok, u.code);
u = await tryUrl("http://studio.example.com", "url-http-remote.json");
check("http + non-loopback host refused", !u.ok && u.code === "CONFIG_STUDIO_URL", u);
u = await tryUrl("https://user:pass@studio.example.com", "url-creds.json");
check("embedded credentials refused", !u.ok && u.code === "CONFIG_STUDIO_URL", u);
check("credential refusal never echoes the credentials", !u.ok && !u.message.includes("pass"));
u = await tryUrl("not a url at all", "url-garbage.json");
check("garbage studioUrl refused", !u.ok && u.code === "CONFIG_STUDIO_URL", u);
u = await tryUrl("ftp://x", "url-ftp.json");
check("non-http(s) scheme refused", !u.ok && u.code === "CONFIG_STUDIO_URL", u);

console.log("Read-only vault boundary (FIX 6):");
{
  // inboxPath inside the vault
  const p = await writeConfig({ ...base, inboxPath: path.join(vaultReal, "inbox") }, 0o600, "overlap-inbox.json");
  try {
    await loadConfig({ configPath: p });
    check("inboxPath inside the vault refused", false);
  } catch (e) {
    check("inboxPath inside the vault refused", e.code === "CONFIG_VAULT_OVERLAP", e.code);
  }
}
{
  // inboxPath EQUAL to the vault
  const p = await writeConfig({ ...base, inboxPath: vaultReal }, 0o600, "overlap-inbox-eq.json");
  try {
    await loadConfig({ configPath: p });
    check("inboxPath equal to the vault refused", false);
  } catch (e) {
    check("inboxPath equal to the vault refused", e.code === "CONFIG_VAULT_OVERLAP", e.code);
  }
}
{
  // inboxPath whose (not-yet-existing) parent is a symlink into the vault
  await mkdir(path.join(vaultReal, "05 Signals"), { recursive: true });
  const linkedParent = path.join(dir, "sneaky-link");
  await symlink(path.join(vaultReal, "05 Signals"), linkedParent);
  const p = await writeConfig(
    { ...base, inboxPath: path.join(linkedParent, "new-inbox") },
    0o600,
    "overlap-symlink.json",
  );
  try {
    await loadConfig({ configPath: p });
    check("symlinked parent resolving into the vault refused", false);
  } catch (e) {
    check("symlinked parent resolving into the vault refused", e.code === "CONFIG_VAULT_OVERLAP", e.code);
  }
}
{
  // config file (and therefore status.json) inside the vault
  const inVault = path.join(vaultReal, "config.json");
  await writeFile(inVault, JSON.stringify(base));
  await chmod(inVault, 0o600);
  try {
    await loadConfig({ configPath: inVault });
    check("config file inside the vault refused (statusPath covered too)", false);
  } catch (e) {
    check("config file inside the vault refused (statusPath covered too)", e.code === "CONFIG_VAULT_OVERLAP", e.code);
  }
  await rm(inVault, { force: true });
}
{
  // logPath inside the vault
  const p = await writeConfig(
    { ...base, logPath: path.join(vaultReal, "companion.log") },
    0o600,
    "overlap-log.json",
  );
  try {
    await loadConfig({ configPath: p });
    check("logPath inside the vault refused", false);
  } catch (e) {
    check("logPath inside the vault refused", e.code === "CONFIG_VAULT_OVERLAP", e.code);
  }
}

console.log("watchGlob traversal safety (FIX 6):");
for (const [glob, label] of [
  ["../elsewhere/**/*.md", "leading .. traversal"],
  ["a/../../b/*.md", "embedded .. traversal"],
  ["/Users/elsewhere/**/*.md", "absolute glob"],
]) {
  const p = await writeConfig({ ...base, watchGlob: glob }, 0o600, `glob-${label.replaceAll(" ", "-")}.json`);
  try {
    await loadConfig({ configPath: p });
    check(`${label} refused`, false);
  } catch (e) {
    check(`${label} refused`, e.code === "CONFIG_WATCH_GLOB", e.code);
  }
}
for (const glob of ["**/*.md", "02 Concepts (Ontology)/**/*.md", "notes/*.md"]) {
  const p = await writeConfig({ ...base, watchGlob: glob }, 0o600, `glob-ok-${glob.length}.json`);
  const c = await loadConfig({ configPath: p });
  check(`relative glob "${glob}" accepted`, c.watchGlob === glob);
}

await rm(dir, { recursive: true, force: true });
summary("config");
