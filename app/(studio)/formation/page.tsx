import { getMode } from "@/lib/modes";
import { FormationTopic } from "@/components/studio/FormationTopic";
import { getEmerging, getProjection } from "@/lib/projection";

export const dynamic = "force-dynamic";

const mode = getMode("formation")!;

export default async function FormationPage() {
  // Snapshot rule (§8): one projection snapshot per request.
  const projection = await getProjection();
  const emerging = getEmerging(projection);
  const emergingProvenance =
    projection.source === "live"
      ? projection.stale || !projection.lastSuccessfulSync
        ? "from the vault · live · stale"
        : "from the vault · live"
      : projection.source === "fallback"
        ? "from the vault · fixture"
        : "curated";
  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-[30px] px-9 pb-[72px] pt-[84px]">
      <div>
        <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
          FORMATION · SYNTHESIS OF THE FIELD
        </div>
        <h1 className="mt-3.5 font-serif text-[30px] font-bold leading-[1.3] tracking-[-0.015em]">
          {mode.question}
        </h1>
        <p className="mt-3.5 text-[17px] leading-[1.8] text-strong" style={{ textWrap: "pretty" }}>
          One idea has crossed the threshold. It was not chosen because it is trending — it was chosen
          because the field, the corpus, and your own unanswered questions converge on it.
        </p>
      </div>

      <div>
        <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">THE CONVERGENCE</div>
        <svg width="608" height="150" viewBox="0 0 608 150" className="mt-3 max-w-full">
          <path d="M196,15 C300,15 330,73 400,74" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeDasharray="3 5" style={{ animation: "flowdash 3.2s linear infinite" }} />
          <path d="M196,45 C300,45 330,74 400,74" fill="none" stroke="#D6D3D1" strokeWidth="1.4" strokeDasharray="2 5" style={{ animation: "flowdash 2.7s linear infinite" }} />
          <path d="M196,75 L400,75" fill="none" stroke="#D6D3D1" strokeWidth="2.4" strokeDasharray="3 5" style={{ animation: "flowdash 3s linear infinite" }} />
          <path d="M196,105 C300,105 330,76 400,76" fill="none" stroke="#D6D3D1" strokeWidth="1.2" strokeDasharray="2 5" style={{ animation: "flowdash 3.5s linear infinite" }} />
          <path d="M196,135 C300,135 330,77 400,77" fill="none" stroke="#D6D3D1" strokeWidth="1" strokeDasharray="2 5" style={{ animation: "flowdash 2.9s linear infinite" }} />
          <path d="M400,75 L435,75" fill="none" stroke="#A8A29E" strokeWidth="4" strokeDasharray="4 4" style={{ animation: "flowdash 2.2s linear infinite" }} />
          <circle cx="443" cy="75" r="5" fill="#CA8A04" />
          <circle cx="443" cy="75" r="12" fill="none" stroke="#CA8A04" strokeWidth="1" strokeDasharray="2 3" style={{ animation: "breathe 4s ease infinite" }} />
          <text x="462" y="71" style={{ fontFamily: "var(--font-libre), Georgia, serif", fontSize: 15, fill: "#1C1917" }}>Decision</text>
          <text x="462" y="90" style={{ fontFamily: "var(--font-libre), Georgia, serif", fontSize: 15, fill: "#1C1917" }}>Memory</text>
          <text x="0" y="19" style={{ fontSize: 11, fill: "#78716C" }}>governance debt · concept</text>
          <text x="0" y="49" style={{ fontSize: 11, fill: "#78716C" }}>ai code generation · signal</text>
          <text x="0" y="79" style={{ fontSize: 11, fill: "#78716C" }}>magnolia · builder&rsquo;s log</text>
          <text x="0" y="109" style={{ fontSize: 11, fill: "#78716C" }}>what should it remember? · question</text>
          <text x="0" y="139" style={{ fontSize: 11, fill: "#78716C" }}>human judgment · adjacent</text>
        </svg>
        <div className="mt-1.5 text-[13px] italic text-faint">
          Five tributaries, one river. The topic was not chosen — it became inevitable.
        </div>
      </div>

      <FormationTopic />

      <div className="border border-line bg-surface px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-2 font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
          <span>STILL FORMING · REFERENCED BUT NOT YET WRITTEN</span>
          {/* data-layer provenance — live / fixture / stale, never silent (§8) */}
          <span className="font-normal normal-case text-line2">· {emergingProvenance}</span>
        </div>
        {emerging.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5 text-[14px] leading-[1.6] text-muted">
            {emerging.map((e) => (
              <li key={e.term}>
                <i>{e.term}</i>{" "}
                <span className="text-faint">— referenced {e.references}× across the field, no note yet</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[14px] leading-[1.7] text-muted">
            Two other topics are forming but have not crossed the threshold. Formation will speak when
            they are ready.
          </p>
        )}
      </div>
    </div>
  );
}
