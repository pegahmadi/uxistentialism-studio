"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getManuscriptStore, setManuscriptStore, useManuscriptStore } from "./useManuscriptStore";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

import type { IterationView } from "@/lib/iteration";
import {
  MANUSCRIPT_TYPES,
  UNTITLED,
  coerceStore,
  emptyContent,
  emptyStore,
  manuscriptId,
  newManuscript,
  saveStore,
  type DocJSON,
  type Manuscript,
  type ManuscriptStore,
  type ManuscriptType,
} from "@/lib/manuscripts";
import { BoardSidebar } from "./BoardSidebar";
import { EditorToolbar } from "./EditorToolbar";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_MS = 500;

export function IterationClient({ view }: { view: IterationView }) {
  // `null` until the browser store is read — localStorage does not exist during SSR,
  // so the first paint must not assume any document.
  const store = useManuscriptStore();
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timer = useRef<number | null>(null);
  const applying = useRef(false); // suppress autosave while loading a doc into the editor
  const fileInput = useRef<HTMLInputElement>(null);

  // The store awaiting a debounced write. Held in a ref so a flush always writes
  // the LATEST edit, never a stale closure.
  const pending = useRef<ManuscriptStore | null>(null);

  /**
   * Write any pending store immediately and synchronously. Called on pagehide and
   * on unmount so edits made inside the debounce window survive navigating away,
   * refreshing, or closing the tab. Deliberately sets no state — it can run while
   * the component is being torn down.
   */
  const flush = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    saveStore(p);
  }, []);

  /** Persist on a short debounce so the status reads Saving… then Saved. */
  const commit = useCallback((next: ManuscriptStore) => {
    setManuscriptStore(next);
    pending.current = next;
    setStatus("saving");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const p = pending.current;
      pending.current = null;
      setStatus(p && saveStore(p) ? "saved" : "error");
    }, AUTOSAVE_MS);
  }, []);

  const patchActive = useCallback(
    (patch: Partial<Omit<Manuscript, "key">>) => {
      const s = getManuscriptStore();
      if (!s?.activeKey) return;
      commit({
        ...s,
        docs: s.docs.map((d) =>
          d.key === s.activeKey ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d,
        ),
      });
    },
    [commit],
  );

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false, autolink: true })],
    content: emptyContent(),
    immediatelyRender: false, // required under SSR to avoid a hydration mismatch
    editorProps: {
      attributes: {
        class: "manuscript-prose min-h-[420px] text-[17px] leading-[1.8] text-ink",
        "aria-label": "Manuscript body",
      },
    },
    onUpdate: ({ editor: e }) => {
      if (applying.current) return; // programmatic load, not a user edit
      patchActive({ content: e.getJSON() as DocJSON });
    },
  });

  const active = useMemo(
    () => store?.docs.find((d) => d.key === store.activeKey) ?? null,
    [store],
  );

  // Load the active document into the editor whenever the identity changes.
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || !active) return;
    if (loadedKey.current === active.key) return;
    loadedKey.current = active.key;
    applying.current = true;
    editor.commands.setContent(active.content, { emitUpdate: false });
    applying.current = false;
  }, [editor, active]);

  // Never lose an edit made inside the debounce window: flush on pagehide (covers
  // navigation, refresh, tab close, and bfcache) and again on unmount.
  useEffect(() => {
    const onPageHide = () => flush();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      flush();
    };
  }, [flush]);

  // ── document operations ────────────────────────────────────────────────────
  const createDoc = (type: ManuscriptType) => {
    const s = getManuscriptStore() ?? emptyStore();
    const doc = newManuscript(type);
    commit({ ...s, docs: [...s.docs, doc], activeKey: doc.key });
  };

  const switchDoc = (key: string) => {
    const s = getManuscriptStore();
    if (!s || s.activeKey === key) return;
    commit({ ...s, activeKey: key });
  };

  const deleteDoc = (doc: Manuscript) => {
    const s = getManuscriptStore();
    if (!s) return;
    const label = doc.title.trim() || UNTITLED;
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return;
    const docs = s.docs.filter((d) => d.key !== doc.key);
    if (docs.length === 0) {
      const fresh = newManuscript();
      loadedKey.current = null;
      commit({ version: 1, docs: [fresh], activeKey: fresh.key });
      return;
    }
    const activeKey = s.activeKey === doc.key ? docs[0].key : s.activeKey;
    if (s.activeKey === doc.key) loadedKey.current = null;
    commit({ ...s, docs, activeKey });
  };

  const exportJson = () => {
    const s = getManuscriptStore();
    if (!s) return;
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `studio-drafts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    let incoming: ManuscriptStore;
    try {
      incoming = coerceStore(JSON.parse(await file.text()));
    } catch {
      window.alert("That file could not be read as Studio drafts JSON.");
      return;
    }
    if (incoming.docs.length === 0) {
      window.alert("No drafts found in that file.");
      return;
    }
    // Non-destructive: imported drafts replace same-key drafts, others are added.
    const s = getManuscriptStore() ?? emptyStore();
    const byKey = new Map(s.docs.map((d) => [d.key, d]));
    for (const d of incoming.docs) byKey.set(d.key, d);
    const docs = [...byKey.values()];
    loadedKey.current = null;
    commit({ version: 1, docs, activeKey: incoming.activeKey ?? docs[0].key });
  };

  // ── board association (req 9) ──────────────────────────────────────────────
  // Advice belongs to one manuscript: the board's manuscript.id must equal the
  // open draft's id (its title slug). Untitled drafts match nothing.
  const openId = active ? manuscriptId(active.title) : "";
  const boardMatches = Boolean(openId && view.boardManuscriptId && openId === view.boardManuscriptId);

  const statusLabel =
    status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Not saved" : "";

  return (
    <div className="flex items-start justify-center gap-12 px-10 pb-[72px] pt-[72px]">
      {/* manuscript — sacred, widest, calmest. Now genuinely editable. */}
      <div className="min-w-[340px] max-w-[600px] flex-[0_1_600px]">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-4">
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
            ITERATION · {(active?.title.trim() || UNTITLED).toUpperCase()}
          </span>
          <span
            className={`flex-none font-mono text-[11px] tracking-[0.04em] ${status === "error" ? "text-amber" : "text-faint"}`}
            role="status"
            aria-live="polite"
          >
            {statusLabel}
          </span>
        </div>

        {!store ? (
          <div className="font-mono text-[11px] tracking-[0.06em] text-faint">opening drafts…</div>
        ) : (
          <>
            {/* drafts — switch, or begin another */}
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {store.docs.map((d) => {
                const isActive = d.key === store.activeKey;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => switchDoc(d.key)}
                    aria-current={isActive}
                    className={[
                      "max-w-[220px] truncate px-2 py-1 font-mono text-[10px] tracking-[0.06em] transition-colors",
                      isActive ? "bg-surface2 text-ink" : "text-faint hover:bg-surface hover:text-muted",
                    ].join(" ")}
                    title={`${d.title.trim() || UNTITLED} · ${d.type}`}
                  >
                    {(d.title.trim() || UNTITLED).toUpperCase()}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => createDoc("Medium")}
                className="px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-faint transition-colors hover:bg-surface hover:text-ink"
                title="Begin a new manuscript"
              >
                + NEW
              </button>
            </div>

            {/* title — renaming is just writing the title */}
            <input
              value={active?.title ?? ""}
              onChange={(e) => patchActive({ title: e.target.value })}
              placeholder={UNTITLED}
              aria-label="Manuscript title"
              className="mb-2 w-full bg-transparent font-serif text-[26px] leading-[1.3] text-ink outline-none placeholder:text-line2"
            />

            {/* type · export · import · delete */}
            <div className="mb-5 flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.06em] text-faint">
              <label className="flex items-center gap-1.5">
                <span className="sr-only">Manuscript type</span>
                <select
                  value={active?.type ?? "Medium"}
                  onChange={(e) => patchActive({ type: e.target.value as ManuscriptType })}
                  aria-label="Manuscript type"
                  className="bg-transparent font-mono text-[10px] uppercase tracking-[0.06em] text-muted outline-none"
                >
                  {MANUSCRIPT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <span aria-hidden className="text-line2">·</span>
              <button type="button" onClick={exportJson} className="uppercase tracking-[0.06em] hover:text-ink">
                export
              </button>
              <button type="button" onClick={() => fileInput.current?.click()} className="uppercase tracking-[0.06em] hover:text-ink">
                import
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importJson(f);
                  e.target.value = ""; // allow re-importing the same file
                }}
              />
              <span aria-hidden className="text-line2">·</span>
              {active && (
                <button type="button" onClick={() => deleteDoc(active)} className="uppercase tracking-[0.06em] hover:text-amber">
                  delete
                </button>
              )}
            </div>

            {/* A round mismatch is only meaningful when the board is reviewing THIS piece. */}
            {boardMatches && view.roundMismatch && (
              <div className="mb-4 border-l-2 border-amber pl-3 font-mono text-[11px] leading-[1.6] text-amber">
                You are on round {view.roundMismatch.workspace}; the board last reviewed round {view.roundMismatch.board}.
              </div>
            )}

            <EditorToolbar editor={editor} />
            <EditorContent editor={editor} />
          </>
        )}
      </div>

      <BoardSidebar view={view} matches={boardMatches} />
    </div>
  );
}
