/*
 * Companion configuration loader (WS-2).
 *
 * Reads ~/.config/uxistentialism-studio/config.json (overridable for tests).
 *
 * Security posture (PLAN.md rule 6, WORKSTREAM Coordinator Amendment #7):
 *   - REFUSES TO START unless the config file is exactly owner-accessible
 *     (no group/other permission bits — i.e. mode 600).
 *   - The sync secret is exposed as a NON-ENUMERABLE property so it can never
 *     be serialized by JSON.stringify, Object.entries, spread, or logging.
 *   - JSON parse failures raise a generic message: V8's SyntaxError text can
 *     quote file content, which could include the secret.
 *   - vaultPath is realpath-normalized (symlink-resolved) at load time.
 *     inboxPath is resolved here and realpath-normalized by the caller after
 *     the directory is ensured to exist.
 *   - READ-ONLY VAULT BOUNDARY: after realpath normalization, the loader
 *     refuses to start if the inbox, the config file, the status file, or the
 *     log file lives inside (or equals) the vault — every companion write
 *     location must be provably outside the vault. Comparison paths resolve
 *     the deepest EXISTING ancestor via realpath so symlinked parents cannot
 *     smuggle a write location into the vault.
 *   - watchGlob must be vault-relative with no ".." traversal, so the watcher
 *     can never observe (or be pointed) outside the vault root.
 */

import { readFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "uxistentialism-studio",
  "config.json",
);

export class ConfigError extends Error {
  constructor(message, code = "CONFIG_ERROR") {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}

const DEFAULTS = {
  // Relative to vaultPath. The vault root's top-level entries are the content
  // directories themselves ("02 Concepts (Ontology)", …), so the default
  // watches every note under the root; skip folders are excluded by the
  // watcher's ignore rules (see vault-watcher.mjs VAULT_SKIP_FOLDERS).
  watchGlob: "**/*.md",
  debounceMs: 3000,
  reconcileIntervalMs: 21600000, // 6h
  requestTimeoutMs: 30000,
};

function requireString(parsed, key) {
  const v = parsed[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ConfigError(`Config field "${key}" must be a non-empty string.`, "CONFIG_FIELD");
  }
  return v;
}

function optionalPositiveInt(parsed, key, fallback) {
  const v = parsed[key];
  if (v === undefined || v === null) return fallback;
  if (!Number.isInteger(v) || v <= 0) {
    throw new ConfigError(`Config field "${key}" must be a positive integer.`, "CONFIG_FIELD");
  }
  return v;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * FIX 11 — HTTPS enforcement for the secret's transport.
 * The sync secret travels in the Authorization header of every submission, so
 * plaintext transport is refused outright: https: for any non-loopback host,
 * http: only for localhost / 127.0.0.1 / [::1] (local development), and no
 * credentials embedded in the URL.
 */
function validateStudioUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('Config field "studioUrl" is not a valid URL.', "CONFIG_STUDIO_URL");
  }
  if (url.username || url.password) {
    throw new ConfigError(
      'Config field "studioUrl" must not embed URL credentials — the sync secret travels only in the Authorization header.',
      "CONFIG_STUDIO_URL",
    );
  }
  if (url.protocol === "https:") return raw.replace(/\/+$/, "");
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) {
    return raw.replace(/\/+$/, "");
  }
  throw new ConfigError(
    'Config field "studioUrl" must use https:. Plain http: is allowed only for localhost/127.0.0.1/[::1] — the sync secret must never travel in cleartext.',
    "CONFIG_STUDIO_URL",
  );
}

/**
 * FIX 6 — watchGlob may never escape the vault: it must be a relative glob
 * with no ".." traversal segment.
 */
function validateWatchGlob(glob) {
  if (typeof glob !== "string" || glob.length === 0) {
    throw new ConfigError('Config field "watchGlob" must be a non-empty string.', "CONFIG_WATCH_GLOB");
  }
  if (path.isAbsolute(glob)) {
    throw new ConfigError(
      'Config field "watchGlob" must be relative to vaultPath, not absolute.',
      "CONFIG_WATCH_GLOB",
    );
  }
  if (glob.split(/[\\/]+/).includes("..")) {
    throw new ConfigError(
      'Config field "watchGlob" must not contain ".." traversal — the watcher never leaves the vault.',
      "CONFIG_WATCH_GLOB",
    );
  }
  return glob;
}

/**
 * Resolve a path for boundary comparison: realpath the deepest EXISTING
 * ancestor (so symlinked parents are seen through), then append the
 * not-yet-existing remainder. Never throws.
 */
async function resolveForComparison(p) {
  let base = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join(await realpath(base), ...tail);
    } catch {
      const parent = path.dirname(base);
      if (parent === base) return path.join(base, ...tail);
      tail.unshift(path.basename(base));
      base = parent;
    }
  }
}

const isInsideOrEqual = (child, parent) => child === parent || child.startsWith(parent + path.sep);

/**
 * FIX 6 — the vault is read-only territory: refuse to start if any companion
 * write location (inbox, config file, status file, log file) resolves inside
 * or equal to the vault root.
 */
async function assertOutsideVault(vaultPath, locations) {
  for (const [label, p] of locations) {
    if (p === null || p === undefined) continue;
    const resolved = await resolveForComparison(p);
    if (isInsideOrEqual(resolved, vaultPath)) {
      throw new ConfigError(
        `Config field "${label}" resolves inside the vault. The vault is strictly read-only; ` +
          "every companion write location must live outside vaultPath. Refusing to start.",
        "CONFIG_VAULT_OVERLAP",
      );
    }
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.configPath]
 * @returns {Promise<object>} frozen config; `syncSecret` is non-enumerable
 */
export async function loadConfig({ configPath = DEFAULT_CONFIG_PATH } = {}) {
  let st;
  try {
    st = await stat(configPath);
  } catch {
    throw new ConfigError(
      `Config file not found at ${configPath}. See the companion README for setup.`,
      "CONFIG_MISSING",
    );
  }
  if (!st.isFile()) {
    throw new ConfigError(`Config path is not a regular file: ${configPath}`, "CONFIG_NOT_FILE");
  }
  if ((st.mode & 0o077) !== 0) {
    throw new ConfigError(
      "Config file permissions are too open — it holds the sync secret and must be " +
        `mode 600. Refusing to start. Fix with: chmod 600 ${configPath}`,
      "CONFIG_PERMISSIONS",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    // Deliberately generic: JSON.parse error text can quote file content,
    // which could include the secret.
    throw new ConfigError("Config file is not valid JSON.", "CONFIG_INVALID_JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError("Config file must contain a JSON object.", "CONFIG_INVALID_JSON");
  }

  const rawVaultPath = requireString(parsed, "vaultPath");
  const studioUrl = validateStudioUrl(requireString(parsed, "studioUrl"));
  const syncSecret = requireString(parsed, "syncSecret");
  const rawInboxPath = requireString(parsed, "inboxPath");
  const watchGlob = validateWatchGlob(
    parsed.watchGlob === undefined || parsed.watchGlob === null
      ? DEFAULTS.watchGlob
      : parsed.watchGlob,
  );

  let vaultPath;
  try {
    vaultPath = await realpath(path.resolve(rawVaultPath)); // symlink-normalized root
  } catch {
    throw new ConfigError(
      "Configured vaultPath does not exist or is not accessible.",
      "CONFIG_VAULT_PATH",
    );
  }

  const inboxPath = path.resolve(rawInboxPath);
  const logPath = typeof parsed.logPath === "string" ? parsed.logPath : null;
  const statusPath = path.join(path.dirname(configPath), "status.json");

  // FIX 6 — no companion write location may live inside the read-only vault.
  await assertOutsideVault(vaultPath, [
    ["inboxPath", inboxPath],
    ["configPath", configPath],
    ["statusPath", statusPath],
    ["logPath", logPath],
  ]);

  const config = {
    vaultPath,
    inboxPath,
    studioUrl,
    watchGlob,
    debounceMs: optionalPositiveInt(parsed, "debounceMs", DEFAULTS.debounceMs),
    reconcileIntervalMs: optionalPositiveInt(
      parsed,
      "reconcileIntervalMs",
      DEFAULTS.reconcileIntervalMs,
    ),
    requestTimeoutMs: optionalPositiveInt(parsed, "requestTimeoutMs", DEFAULTS.requestTimeoutMs),
    logPath,
    configPath,
    statusPath,
  };

  // The secret must never be serializable: non-enumerable, read-only.
  Object.defineProperty(config, "syncSecret", {
    value: syncSecret,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(config);
}
