import type { Evidence, IterationView } from "@/lib/iteration";

// The margin — board & lineage. Markup preserved from the original Iteration page;
// the only change is the association gate: board advice belongs to ONE manuscript,
// so it renders only when the board's manuscript.id matches the open draft's id.
// Data-layer provenance stays visible either way — it reports data health, not advice.

function Provenance({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] tracking-[0.06em]">
      {evidence.map((e, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-line2" aria-hidden>·</span>}
          <span className={e.kind === "workspace" ? "text-muted" : "text-faint"}>
            <span className="uppercase">{e.label}</span>
            {e.value && <span className="text-faint">{" · "}{e.value}</span>}
          </span>
        </span>
      ))}
    </div>
  );
}

export function BoardSidebar({ view: v, matches }: { view: IterationView; matches: boolean }) {
  const bp = v.boardProvenance;
  const boardProvenanceLine =
    bp.source === "live"
      ? !bp.lastSuccessfulSync
        ? "board · live · sync time unknown · stale"
        : bp.stale
          ? `board · live · stale · last synced ${bp.lastSuccessfulSync}`
          : `board · live · synced ${bp.lastSuccessfulSync}`
      : bp.source === "fallback"
        ? "board · fixture"
        : "board · curated";

  return (
    <div className="flex w-[300px] flex-none flex-col gap-3.5 pt-[52px]">
      {!matches ? (
        // The review on file is for a different piece — say so plainly and attach
        // none of its advice to the open manuscript.
        <div className="border-l-2 border-line2 px-3.5 py-2">
          <div className="font-mono text-[11px] leading-[1.6] text-faint">
            Review available for another manuscript
          </div>
        </div>
      ) : (
        <>
          {(v.consequentialQuestion || v.board.stance !== "none") && (
            <div className="border-l-2 border-amber px-3.5 py-2">
              <div className="font-mono text-[11px] font-semibold tracking-[0.06em] text-amber" style={{ animation: "breathe 4.5s ease infinite" }}>
                THE BOARD HAS A QUESTION
              </div>
              {v.consequentialQuestion && (
                <div className="mt-1.5 text-[13px] leading-[1.65] text-muted">{v.consequentialQuestion.text}</div>
              )}
              <div className="mt-1.5 text-[12px] leading-[1.6] text-faint">{v.board.summary}</div>
              <Provenance evidence={v.consequentialQuestion?.evidence ?? v.board.evidence} />
            </div>
          )}

          {/* the board — advisory voices. YOU DECIDE. */}
          {v.board.reviewers.length > 0 && (
            <div className="overflow-hidden border border-line2 bg-paper">
              <div className="flex justify-between border-b border-[#fef08a] bg-[#fefce8] px-4 py-2.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-amber">
                <span>THE BOARD · {v.board.reviewers.length} {v.board.reviewers.length === 1 ? "VOICE" : "VOICES"}</span>
                <span>YOU DECIDE</span>
              </div>
              {v.board.reviewers.map((r, i) => (
                <div key={i} className="border-b border-line px-4 py-3 last:border-0">
                  <div className="text-[13px] leading-[1.6] text-strong">
                    <span className="font-mono text-[11px] font-semibold text-muted">{r.glyph}</span>{" "}
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-faint">{r.role}</span>
                    {r.confidence && <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-faint"> · {r.confidence}</span>}
                  </div>
                  {r.recommendation && <div className="mt-1 text-[13px] leading-[1.6] text-strong">{r.recommendation}</div>}
                  {r.diagnosis && <div className="mt-0.5 text-[12px] leading-[1.55] text-muted">{r.diagnosis}</div>}
                </div>
              ))}
              <Provenance evidence={v.board.evidence} />
            </div>
          )}

          {/* rulings — YOUR decisions, visually distinct from the advisory voices above */}
          {v.rulings.items.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
                YOUR RULINGS · {v.rulings.items.length} {v.rulings.items.length === 1 ? "DECISION" : "DECISIONS"}
              </div>
              <div className="flex flex-col gap-2">
                {v.rulings.items.map((r, i) => (
                  <div key={i} className="border-l-2 border-ink bg-paper px-3.5 py-2.5">
                    {r.on && (
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-faint">on · {r.on}</div>
                    )}
                    <div className="mt-1 text-[13px] leading-[1.6] font-medium text-ink">{r.decision}</div>
                  </div>
                ))}
              </div>
              <Provenance evidence={v.rulings.evidence} />
            </div>
          )}

          {/* the next decision the review is waiting on — the board advises, you decide */}
          {v.nextDecision && (
            <div className="border-l-2 border-ink px-3.5 py-2">
              <div className="font-mono text-[11px] font-semibold tracking-[0.06em] text-ink">YOUR NEXT DECISION</div>
              <div className="mt-1.5 text-[13px] leading-[1.65] text-strong">{v.nextDecision.text}</div>
              <Provenance evidence={v.nextDecision.evidence} />
            </div>
          )}

          {/* past rounds — curated lineage */}
          {v.pastRounds.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">PAST ROUNDS · ❧</div>
              <ol className="flex flex-col gap-2.5 border-l border-line pl-5">
                {v.pastRounds.map((entry, i) => (
                  <li key={i} className="relative text-[13px] leading-[1.6] text-muted">
                    <span className="absolute -left-[1.55rem] top-[6px] h-1.5 w-1.5 rounded-full bg-line2" aria-hidden />
                    {entry}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {/* data-layer provenance — live / fixture / stale, never silent (§8) */}
      <div className="font-mono text-[10px] tracking-[0.06em] text-faint">{boardProvenanceLine}</div>

      <div className="pt-1 font-mono text-[12px] tracking-[0.01em] text-faint">
        evidence · revision plan · past rounds — ⌘K
      </div>
    </div>
  );
}
