"use client";

import { useSyncExternalStore } from "react";
import { loadStore, newManuscript, saveStore, type ManuscriptStore } from "@/lib/manuscripts";

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
