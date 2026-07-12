import { getMode } from "@/lib/modes";
import { writingInMode } from "@/lib/content";

// All six Studio environments render dynamically (live-data layer). Distribution
// reads only curated content in v1, but stays on the same request-time path.
export const dynamic = "force-dynamic";

const mode = getMode("distribution")!;
const writing = writingInMode("distribution");

export default function DistributionPage() {
  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-7 px-9 pb-[72px] pt-[84px]">
      <div>
        <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
          DISTRIBUTION · HOW THE WORK TRAVELS
        </div>
        <h1 className="mt-3.5 font-serif text-[30px] font-bold leading-[1.3] tracking-[-0.015em]">
          {mode.question}
        </h1>
        <p className="mt-3.5 text-[17px] leading-[1.8] text-strong" style={{ textWrap: "pretty" }}>
          Framework essays lead on Medium — public intellectual work, arguing with a field. Substack
          follows with the founder&rsquo;s note: what building Magnolia taught the essay. Each channel
          says less than the essay, on purpose.
        </p>
      </div>

      {/* the platforms */}
      <div className="ml-[5px] flex flex-col gap-7 border-l border-line2 pl-[30px]">
        <div className="relative">
          <span className="absolute -left-[35px] top-1 h-[9px] w-[9px] rounded-full bg-ink" />
          <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ink">THE PLATFORMS · EACH SERVES A DIFFERENT PURPOSE</div>
          <div className="mt-2 flex flex-col">
            {[
              ["MEDIUM", "#1c1917", "publishes the framework — the essay, whole"],
              ["SUBSTACK", "#ca8a04", "publishes the builder's perspective — the Magnolia note"],
              ["LINKEDIN", "#78716c", "contributes one mechanism into the live debate"],
              ["X", "#78716c", "tests one sentence — the provocation, nothing more"],
            ].map(([name, color, desc]) => (
              <div key={name} className="flex items-baseline gap-4 border-b border-line py-[11px] last:border-0">
                <span className="w-[76px] flex-none font-mono text-[11px] font-semibold tracking-[0.06em]" style={{ color }}>{name}</span>
                <span className="text-[14px] leading-[1.65] text-strong">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ready to travel — real writing */}
      <div>
        <div className="mb-3 font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">READY TO TRAVEL</div>
        <div className="flex flex-col">
          {writing.map((w) => (
            <div key={w.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3.5 last:border-0">
              <div>
                <div className="font-serif text-[17px] leading-snug text-ink">{w.title}</div>
                <div className="mt-1 text-[14px] leading-[1.6] text-strong">{w.summary}</div>
              </div>
              <span className="flex-none font-mono text-[11px] font-semibold tracking-[0.06em]" style={{ color: w.venue === "Substack" ? "#ca8a04" : "#1c1917" }}>
                {(w.venue ?? "—").toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[13px] text-faint">
        Nothing here publishes anywhere — Distribution is a view onto how an idea would travel, not an
        integration.
      </p>
    </div>
  );
}
