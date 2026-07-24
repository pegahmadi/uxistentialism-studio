"use client";

// Today ↔ Iteration bridge.
//
// Today answers "what deserves my attention today?". If Pegah has a draft open
// in the Studio, that is the honest answer — so an active Studio draft takes the
// focus slot ahead of the legacy Workspace manuscript. With no Studio draft in
// this browser, the Workspace focus renders exactly as before (passed in as
// `fallback`, still server-rendered).
//
// The drafts live in this browser's localStorage, shared with Iteration through
// the same module store, so switching, renaming, and deleting there are
// reflected here. The card says so plainly: these drafts are local to one
// browser, not synced, and Today must never imply otherwise.

import Link from "next/link";
import { UNTITLED } from "@/lib/manuscripts";
import { useMeaningfulDraft } from "./useManuscriptStore";

const link = "cursor-pointer border-b border-line2 text-ink hover:border-muted";

/** Local, readable time. Anything unparseable is simply not claimed. */
function updatedLabel(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TodayActiveDraft({ fallback }: { fallback: React.ReactNode }) {
  const draft = useMeaningfulDraft();

  // No draft worth showing — during SSR, with no drafts at all, or when the only
  // draft is the pristine blank page Iteration seeds. The Workspace focus stands.
  if (!draft) return <>{fallback}</>;

  const title = draft.title.trim() || UNTITLED;
  const updated = updatedLabel(draft.updatedAt);

  return (
    <div style={{ animation: "rise .7s ease .05s backwards" }}>
      <p className="text-[17px] leading-[1.8] text-ink">
        You have a draft open — <i className="text-strong">{title}</i>.{" "}
        <Link href="/iteration" className={`${link} font-medium`}>
          Continue writing ↵
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[10.5px] tracking-[0.06em]">
        <span className="text-muted uppercase">Studio draft · local to this browser</span>
        <span className="text-line2" aria-hidden>·</span>
        <span className="text-faint uppercase">{draft.type}</span>
        {updated && (
          <>
            <span className="text-line2" aria-hidden>·</span>
            <span className="text-faint uppercase">updated {updated}</span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Hides the legacy Workspace *manuscript* action while a meaningful Studio draft
 * is active, so Today never offers "Continue writing" for the open draft and
 * "Open <the old manuscript>" in the same briefing. With no meaningful draft the
 * legacy action renders untouched. Only the manuscript-linked action is wrapped;
 * Formation and Field actions are never suppressed.
 */
export function TodayLegacyManuscriptAction({ children }: { children: React.ReactNode }) {
  const draft = useMeaningfulDraft();
  if (draft) return null;
  return <>{children}</>;
}
