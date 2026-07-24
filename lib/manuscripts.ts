// Personal Writing MVP — browser-local manuscript store.
//
// Scope is deliberately small: drafts live in this browser's localStorage only.
// There is no auth, no Redis manuscript storage, no Obsidian write-back, and no
// publishing integration. JSON export/import exists so a draft is never trapped
// in one browser profile.
//
// Identity, deliberately two-part:
//   * `key`  — a stable opaque id. Storage, switching, and deletion use ONLY this,
//              so renaming a draft never loses it.
//   * `id()` — the manuscript id derived from the title (a slug). This is what the
//              Editorial Board's `manuscript.id` is compared against, so a draft
//              titled "Authority Architecture" adopts the board review for
//              `authority-architecture`. Renaming re-points that association,
//              which is the honest behavior: the id names the piece, not the file.

export const MANUSCRIPT_TYPES = ["Medium", "Substack", "Packt DS Book"] as const;
export type ManuscriptType = (typeof MANUSCRIPT_TYPES)[number];

/** TipTap document JSON. Kept structural so lib/ carries no editor dependency. */
export type DocJSON = Record<string, unknown>;

export interface Manuscript {
  key: string;
  title: string;
  type: ManuscriptType;
  content: DocJSON;
  updatedAt: string;
}

export interface ManuscriptStore {
  version: 1;
  docs: Manuscript[];
  activeKey: string | null;
}

export const STORAGE_KEY = "uxi.studio.manuscripts.v1";
export const UNTITLED = "Untitled";

/** An empty TipTap document — a blank page, never placeholder prose. */
export const emptyContent = (): DocJSON => ({ type: "doc", content: [{ type: "paragraph" }] });

/**
 * The manuscript id compared against the board's `manuscript.id`.
 * Untitled or unsluggable drafts yield "" — which matches no board review.
 */
export function manuscriptId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newManuscript(type: ManuscriptType = "Medium"): Manuscript {
  return { key: newKey(), title: UNTITLED, type, content: emptyContent(), updatedAt: new Date().toISOString() };
}

export const emptyStore = (): ManuscriptStore => ({ version: 1, docs: [], activeKey: null });

const isType = (v: unknown): v is ManuscriptType =>
  typeof v === "string" && (MANUSCRIPT_TYPES as readonly string[]).includes(v);

/** Accept only shapes we can render; anything else is discarded rather than trusted. */
function coerceManuscript(v: unknown): Manuscript | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const content = o.content && typeof o.content === "object" && !Array.isArray(o.content)
    ? (o.content as DocJSON)
    : emptyContent();
  return {
    key: typeof o.key === "string" && o.key ? o.key : newKey(),
    title: typeof o.title === "string" ? o.title : UNTITLED,
    type: isType(o.type) ? o.type : "Medium",
    content,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
  };
}

/** Parse a store from arbitrary JSON (localStorage or an imported file). */
export function coerceStore(v: unknown): ManuscriptStore {
  if (!v || typeof v !== "object" || Array.isArray(v)) return emptyStore();
  const o = v as Record<string, unknown>;
  const docs = Array.isArray(o.docs) ? o.docs.map(coerceManuscript).filter((d): d is Manuscript => d !== null) : [];
  const activeKey = typeof o.activeKey === "string" && docs.some((d) => d.key === o.activeKey) ? o.activeKey : docs[0]?.key ?? null;
  return { version: 1, docs, activeKey };
}

/** Concatenated text of a TipTap document — used only to ask "did anyone write?" */
export function documentText(content: DocJSON): string {
  let out = "";
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (typeof o.text === "string") out += o.text;
    if (Array.isArray(o.content)) walk(o.content);
  };
  walk(content);
  return out;
}

/**
 * A draft becomes meaningful the moment it carries something Pegah wrote — a
 * real title OR any body text. The blank document Iteration auto-seeds (so the
 * editor always has a page open) is deliberately NOT meaningful: Today would
 * otherwise point at "Untitled" and bury the Workspace focus behind an empty
 * page. An Untitled draft that has body text IS meaningful — the writing is what
 * counts, not the naming.
 */
export function isMeaningfulDraft(m: Manuscript): boolean {
  const title = m.title.trim();
  if (title !== "" && title !== UNTITLED) return true;
  return documentText(m.content).trim() !== "";
}

export function loadStore(): ManuscriptStore {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    return coerceStore(JSON.parse(raw));
  } catch {
    return emptyStore(); // corrupt payload must not brick the editor
  }
}

/** @returns true when the write landed; false lets the caller show an honest status. */
export function saveStore(store: ManuscriptStore): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false; // quota or private-mode failure — never silently claim "Saved"
  }
}
