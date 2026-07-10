import { getIterationView, type Evidence } from "@/lib/iteration";

// Structured provenance in the same restrained mono language used across the Studio.
// Authored (Workspace) reads a shade stronger than projected/curated.
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

export default function IterationPage() {
  const v = getIterationView();
  const m = v.manuscript;
  const meta = [m.venue, m.status].filter(Boolean).join(" · ");

  return (
    <div className="flex items-start justify-center gap-12 px-10 pb-[72px] pt-[72px]">
      {/* manuscript — sacred, widest, calmest. BODY PRESERVED EXACTLY AS CURATED. */}
      <div className="min-w-[340px] max-w-[600px] flex-[0_1_600px]">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-4">
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
            ITERATION · {m.title.toUpperCase()}
            {m.round != null && ` · ROUND ${m.round}`}
          </span>
          <span className="flex-none font-mono text-[11px] tracking-[0.04em] text-faint">
            {meta || "in review"}
          </span>
        </div>
        {v.roundMismatch && (
          <div className="mb-4 border-l-2 border-amber pl-3 font-mono text-[11px] leading-[1.6] text-amber">
            You are on round {v.roundMismatch.workspace}; the board last reviewed round {v.roundMismatch.board}.
          </div>
        )}
        <div className="mb-6 font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
          § THE MECHANISM QUESTION
        </div>
        <div className="text-[17px] leading-[1.8] text-ink" style={{ textWrap: "pretty" }}>
          <p className="mb-5">
            Automation does not, by itself, remove human authority. The removal begins when authority is
            assumed rather than placed — when the system acts and no one can say, afterward, who decided
            it should.
          </p>
          <p className="mb-5">
            Consider the review that exists to be passed rather than to be useful. Authority has not
            disappeared; it has been <span className="border-b border-dotted border-faint">delegated to the
            artifact of review</span> — the checklist, the score — and the decision now belongs to no one.
          </p>
          <p className="m-0 min-h-[60px]" contentEditable suppressContentEditableWarning style={{ caretColor: "#78716c" }}>
            This suggests authority architecture has a mechanism:&nbsp;
          </p>
        </div>
      </div>

      {/* margin — board & lineage, driven by the projection, never competing with the manuscript */}
      <div className="flex w-[300px] flex-none flex-col gap-3.5 pt-[52px]">
        {/* the board's question + its stance (disagreement only when it materially differs) */}
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

        <div className="pt-1 font-mono text-[12px] tracking-[0.01em] text-faint">
          evidence · revision plan · past rounds — ⌘K
        </div>
      </div>
    </div>
  );
}
