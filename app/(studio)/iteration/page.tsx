import { IDEAS } from "@/lib/content";

const idea = IDEAS.find((i) => i.id === "authority-architecture")!;

export default function IterationPage() {
  return (
    <div className="flex items-start justify-center gap-12 px-10 pb-[72px] pt-[72px]">
      {/* manuscript — sacred, widest, calmest */}
      <div className="min-w-[340px] max-w-[600px] flex-[0_1_600px]">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-4">
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
            ITERATION · AUTHORITY ARCHITECTURE · ROUND 3
          </span>
          <span className="flex-none font-mono text-[11px] tracking-[0.04em] text-faint">
            series, in review · medium
          </span>
        </div>
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

      {/* margin — board & lineage, never competing with the manuscript */}
      <div className="flex w-[300px] flex-none flex-col gap-3.5 pt-[52px]">
        <div className="border-l-2 border-amber px-3.5 py-2">
          <div className="font-mono text-[11px] font-semibold tracking-[0.06em] text-amber" style={{ animation: "breathe 4.5s ease infinite" }}>
            THE BOARD HAS A QUESTION
          </div>
          <div className="mt-1.5 text-[13px] leading-[1.65] text-muted">
            ❧ and ▦ disagree about §3&rsquo;s ground. One ruling, when you&rsquo;re ready.
          </div>
        </div>

        <div className="overflow-hidden border border-line2 bg-paper">
          <div className="flex justify-between border-b border-[#fef08a] bg-[#fefce8] px-4 py-2.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-amber">
            <span>THE BOARD · 3 VOICES</span><span>YOUR RULING</span>
          </div>
          <div className="border-b border-line px-4 py-3 text-[13px] leading-[1.65] text-strong">
            <span className="font-mono text-[11px] font-semibold text-muted">▦</span> This claim needs evidence — a documented case.
          </div>
          <div className="border-b border-line px-4 py-3 text-[13px] leading-[1.65] text-strong">
            <span className="font-mono text-[11px] font-semibold text-green">❧</span> Disagree — observe first. You&rsquo;re theorizing.
          </div>
          <div className="px-4 py-3 text-[13px] leading-[1.65] text-strong">
            <span className="font-mono text-[11px] font-semibold text-ink">●</span> Evidence that follows observation persuades; evidence that precedes it decorates.
          </div>
        </div>

        <div>
          <div className="mb-2 font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">PAST ROUNDS · ❧</div>
          <ol className="flex flex-col gap-2.5 border-l border-line pl-5">
            {idea.lineage?.map((entry, i) => (
              <li key={i} className="relative text-[13px] leading-[1.6] text-muted">
                <span className="absolute -left-[1.55rem] top-[6px] h-1.5 w-1.5 rounded-full bg-line2" aria-hidden />
                {entry}
              </li>
            ))}
          </ol>
        </div>

        <div className="pt-1 font-mono text-[12px] tracking-[0.01em] text-faint">
          evidence · revision plan · past rounds — ⌘K
        </div>
      </div>
    </div>
  );
}
