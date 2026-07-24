"use client";

import { useSyncExternalStore } from "react";
import {
  isMeaningfulDraft,
  loadStore,
  newManuscript,
  saveStore,
  type Manuscript,
  type ManuscriptStore,
} from "@/lib/manuscripts";

// localStorage is an external store that does not exist during SSR, so it is read
// through useSyncExternalStore rather than a mount effect: the server snapshot is
// null (the pane renders "opening drafts…"), hydration matches it exactly, and the
// real drafts arrive on the first client read. No cascading setState in an effect.

let snapshot: ManuscriptStore | null = null;
const listeners = new Set<() => void>();

/** Read-through cache. Seeds exactly one blank document on a first-ever visit. */
function ensure(): ManuscriptStore {
  if (snapshot) return snapshot;
  const loaded = loadStore();
  if (loaded.docs.length === 0) {
    const doc = newManuscript();
    snapshot = { version: 1, docs: [doc], activeKey: doc.key };
    saveStore(snapshot);
  } else {
    snapshot = loaded;
  }
  return snapshot;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getSnapshot = (): ManuscriptStore | null => ensure();
const getServerSnapshot = (): ManuscriptStore | null => null;

/** Current drafts outside of render (event handlers, editor callbacks). */
export const getManuscriptStore = (): ManuscriptStore | null => snapshot;

/** Publish a new store to every subscriber. Persistence is the caller's business. */
export function setManuscriptStore(next: ManuscriptStore): void {
  snapshot = next;
  for (const l of listeners) l();
}

export function useManuscriptStore(): ManuscriptStore | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ── read-only access (Today) ───────────────────────────────────────────────
// Today observes the same drafts Iteration owns, but must NEVER seed: seeding
// here would manufacture a draft on first visit and permanently hide the
// Workspace fallback. So this path reads, never writes, and reports "no drafts"
// honestly as null. Once Iteration has loaded or seeded, both share `snapshot`,
// which is why switching, renaming, and deleting show up on Today immediately.

let checkedForDrafts = false;

function getReadOnlySnapshot(): ManuscriptStore | null {
  if (snapshot) return snapshot;
  if (!checkedForDrafts) {
    checkedForDrafts = true;
    const loaded = loadStore();
    if (loaded.docs.length > 0) {
      snapshot = loaded; // adopt into the shared cache — a read, not a seed
      return snapshot;
    }
  }
  return null; // stable null: no drafts in this browser
}

/** The drafts as they are, or null when this browser holds none. Never seeds. */
export function useManuscriptStoreReadOnly(): ManuscriptStore | null {
  return useSyncExternalStore(subscribe, getReadOnlySnapshot, getServerSnapshot);
}

/**
 * The active draft, but only once it carries real writing. One predicate shared
 * by every Today slot, so the draft card and the legacy manuscript action can
 * never disagree about whether a draft is worth showing.
 */
export function useMeaningfulDraft(): Manuscript | null {
  const store = useManuscriptStoreReadOnly();
  const active = store?.docs.find((d) => d.key === store.activeKey) ?? null;
  return active && isMeaningfulDraft(active) ? active : null;
}
