"use client";

// Field Research (WS-Field-Research) — one explicit action, a sourced brief,
// approve/dismiss per finding. Nothing runs on its own: the brief appears only
// after Pegah triggers it, and re-rendering restored state is not re-running
// research. When no live provider is connected the action is labelled as a
// demonstration preview — it never implies that clicking performs research.
//
// Approved findings move to a visible "Approved queue" staged in this
// browser's localStorage; vault delivery is not connected yet and the queue
// says so in user-facing language. Dismissing is non-destructive: the finding
// and its source data remain, and every decision can be reconsidered. If
// browser storage is unavailable, the UI says decisions are not saved rather
// than silently presenting them as persistent.

import { useSyncExternalStore } from "react";
import type { DataSource } from "@/lib/data-result";
import { attributableFindings, type FindingLevel, type ResearchBrief, type ResearchFinding } from "@/lib/field-research";

type Decision = "approved" | "dismissed";

interface StoredState {
  /** ISO timestamp of the one explicit trigger; null = not yet requested. */
  requestedAt: string | null;
  decisions: Record<string, Decision>;
}

interface StoreSnapshot extends StoredState {
  /** True when a localStorage write failed — decisions will not persist. */
  persistFailed: boolean;
}

const STORAGE_KEY = "uxi-field-research-v1";
const EMPTY: StoreSnapshot = { requestedAt: null, decisions: {}, persistFailed: false };

function readStored(): StoredState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const o = parsed as Record<string, unknown>;
    const decisions: Record<string, Decision> = {};
    if (o.decisions && typeof o.decisions === "object") {
      for (const [id, v] of Object.entries(o.decisions as Record<string, unknown>)) {
        if (v === "approved" || v === "dismissed") decisions[id] = v;
      }
    }
    return { requestedAt: typeof o.requestedAt === "string" ? o.requestedAt : null, decisions };
  } catch {
    return EMPTY;
  }
}

/** @returns whether the write actually persisted. */
function writeStored(state: StoredState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ requestedAt: state.requestedAt, decisions: state.decisions }));
    return true;
  } catch {
    return false; // storage unavailable — surfaced as "Decisions not saved"
  }
}

// localStorage as an external store (useSyncExternalStore): the server
// snapshot is the stable EMPTY state, the client snapshot is read once and
// cached, and every update goes through setStored so subscribers re-render.
let storeCache: StoreSnapshot | null = null;
const storeListeners = new Set<() => void>();

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

function getStoreSnapshot(): StoreSnapshot {
  if (storeCache === null) storeCache = { ...readStored(), persistFailed: false };
  return storeCache;
}

function getServerSnapshot(): StoreSnapshot {
  return EMPTY;
}

function setStored(next: StoredState) {
  const persisted = writeStored(next);
  storeCache = { ...next, persistFailed: !persisted };
  storeListeners.forEach((l) => l());
}

const LEVEL_COLOR: Record<FindingLevel, string> = {
  high: "#CA8A04", // amber — worth judgment now
  medium: "#78716C",
  low: "#A8A29E",
};

function marks(relevance: FindingLevel, confidence: FindingLevel) {
  return (
    <span className="flex-none font-mono text-[11px] tracking-[0.04em]">
      <span style={{ color: LEVEL_COLOR[relevance] }}>relevance {relevance}</span>
      <span className="text-faint"> · </span>
      <span className="text-muted">confidence {confidence}</span>
    </span>
  );
}

function sourceLine(f: ResearchFinding, isSample: boolean) {
  return (
    <div className="mt-2 font-mono text-[11px] tracking-[0.04em] text-faint">
      source:{" "}
      <a href={f.source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line2 underline-offset-2 hover:text-muted">
        {f.source.title}
      </a>
      {isSample && " · sample"}
    </div>
  );
}

export function FieldResearch({ brief, source }: { brief: ResearchBrief; source: DataSource }) {
  // Server renders the EMPTY snapshot; after hydration the client snapshot
  // (localStorage) takes over and any stored decisions appear.
  const stored = useSyncExternalStore(subscribeStore, getStoreSnapshot, getServerSnapshot);

  const findings = attributableFindings(brief); // unsourced findings are never shown
  const isSample = source !== "live"; // "default"/"fallback" = sample tiers; never imply a live source

  const request = () => {
    if (stored.requestedAt) return; // one explicit trigger
    setStored({ ...stored, requestedAt: new Date().toISOString() });
  };

  const decide = (id: string, decision: Decision | null) => {
    const decisions = { ...stored.decisions };
    if (decision === null) delete decisions[id];
    else decisions[id] = decision;
    setStored({ ...stored, decisions });
  };

  const requested = stored.requestedAt;
  const decisions = stored.decisions;
  const approved = findings.filter((f) => decisions[f.id] === "approved");
  const rest = findings.filter((f) => decisions[f.id] !== "approved"); // pending + dismissed stay in the brief
  const dismissedCount = findings.filter((f) => decisions[f.id] === "dismissed").length;
  const pendingCount = findings.length - approved.length - dismissedCount;

  return (
    <div className="mb-2 border-b border-line pb-6">
      <div className="flex items-baseline justify-between gap-3 pt-1">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.08em] text-strong">FIELD RESEARCH</div>
          <div className="mt-1 text-[13px] text-muted">one explicit action — nothing runs on its own</div>
        </div>
        {!requested && (
          <button onClick={request} className="cursor-pointer border border-line2 px-3.5 py-1.5 text-[13px] font-medium text-strong hover:bg-surface">
            {isSample ? "Preview demonstration brief" : "Research the field"}
          </button>
        )}
        {requested && (
          <span className="font-mono text-[11px] tracking-[0.04em] text-faint">
            {isSample ? "previewed" : "researched"} {requested}
          </span>
        )}
      </div>

      {requested && (
        <div className="env-enter">
          {isSample && (
            <div className="mt-4 border border-line2 bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed tracking-[0.04em] text-muted">
              sample — no live research provider is connected; these findings are illustrative, not live
            </div>
          )}

          {stored.persistFailed && (
            <div className="mt-3 font-mono text-[11px] tracking-[0.04em] text-amber">
              Decisions not saved — browser storage is unavailable; approvals and dismissals will not survive a refresh
            </div>
          )}

          <div className="mt-1">
            {rest.map((f) => {
              const decision = decisions[f.id] ?? null;
              return (
                <div key={f.id} className="border-b border-line py-4 last:border-b-0" style={{ opacity: decision === "dismissed" ? 0.55 : 1 }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-baseline gap-2.5">
                      <span className="text-[11px] font-semibold tracking-[0.08em] text-strong">FINDING</span>
                      {decision === null && <span className="font-mono text-[11px] tracking-[0.04em] text-amber">needs judgment</span>}
                      {decision === "dismissed" && <span className="font-mono text-[11px] tracking-[0.04em] text-faint">dismissed</span>}
                    </span>
                    {marks(f.relevance, f.confidence)}
                  </div>
                  <div className="mt-[7px] font-serif text-[17px] leading-snug text-ink">{f.title}</div>
                  <div className="mt-2 text-[14px] leading-[1.7] text-strong">{f.summary}</div>
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold tracking-[0.08em] text-muted">WHY THIS MATTERS</div>
                    <div className="mt-1 text-[14px] leading-[1.7] text-strong">{f.relevanceToPegah}</div>
                  </div>
                  {sourceLine(f, isSample)}
                  <div className="mt-3 flex gap-2 text-[13px] font-medium">
                    {decision === null ? (
                      <>
                        <button onClick={() => decide(f.id, "approved")} className="cursor-pointer border border-line2 px-3.5 py-1.5 text-strong hover:bg-surface">
                          Approve
                        </button>
                        <button onClick={() => decide(f.id, "dismissed")} className="cursor-pointer px-3.5 py-1.5 text-muted hover:bg-surface">
                          Dismiss
                        </button>
                      </>
                    ) : (
                      <button onClick={() => decide(f.id, null)} className="cursor-pointer px-3.5 py-1.5 text-muted hover:bg-surface">
                        Reconsider
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 font-mono text-[11px] tracking-[0.04em] text-muted">
            {approved.length} approved · {dismissedCount} dismissed · {pendingCount} awaiting judgment
          </div>

          {approved.length > 0 && (
            <div className="mt-5 border border-line2 bg-surface px-4 pb-4 pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-strong">APPROVED QUEUE</span>
                <span className="font-mono text-[11px] tracking-[0.04em] text-muted">Approved here · vault delivery is not connected yet.</span>
              </div>
              {approved.map((f) => (
                <div key={f.id} className="border-b border-line py-3 last:border-b-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-[15px] leading-snug text-ink">{f.title}</span>
                    {marks(f.relevance, f.confidence)}
                  </div>
                  {sourceLine(f, isSample)}
                  <div className="mt-2 flex gap-2 text-[13px] font-medium">
                    <button onClick={() => decide(f.id, null)} className="cursor-pointer px-2 py-0.5 text-muted hover:bg-paper">
                      Reconsider
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
