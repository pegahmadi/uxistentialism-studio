import { IDEAS, writingInMode, PRODUCTS, QUESTIONS } from "@/lib/content";
import { getConcepts, getConcept, getEmerging } from "@/lib/projection";

const authorityLineage = IDEAS.find((i) => i.id === "authority-architecture")!.lineage ?? [];
const authority = getConcept("authority-architecture");
const traveled = writingInMode("memory").filter((w) => w.status === "published");
const magnolia = PRODUCTS[0];
const question = QUESTIONS.find((q) => q.id === "what-remembered")!;
const canon = getConcepts();
const emerging = getEmerging();
const fromVault = authority?.source === "vault";

const PHASES = ["2024 · BORROWED", "2025 · DEFINED", "2026 · EXPANDED"];

export default function MemoryPage() {
  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-[30px] px-9 pb-[72px] pt-[84px]" style={{ color: "#D6D3D1" }}>
      <div>
        <div className="font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: "#78716C" }}>
          MEMORY · WHAT THE WORK HAS BECOME
        </div>
        <h1 className="mt-3.5 font-serif text-[30px] font-bold leading-[1.3] tracking-[-0.015em]" style={{ color: "#FAFAF9" }}>
          The shape your thinking has taken.
        </h1>
        <p className="mt-3.5 text-[16px] leading-[1.8]" style={{ color: "#A8A29E", textWrap: "pretty" }}>
          § has read the essays against the corpus. What began as a single frustration has become a
          working theory of authority — and it is starting to travel without you.
        </p>
      </div>

      {/* lineage — phase narrative is hand-authored; the backlink count is vault-derived */}
      <div>
        <div className="flex flex-wrap items-baseline gap-2 font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: "#78716C" }}>
          <span>THE LINEAGE OF AUTHORITY</span>
          <span style={{ color: "#57534E" }}>· narrative hand-authored</span>
          {authority && (
            <span style={{ color: "#CA8A04" }}>
              · {authority.backlinks} backlinks in the vault{fromVault ? "" : " (curated)"}
            </span>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-5 border-l pl-[26px]" style={{ borderColor: "#57534E", marginLeft: 4 }}>
          {authorityLineage.map((entry, i) => (
            <div key={i} className="relative">
              <span className="absolute -left-[31px] top-1 h-2 w-2 rounded-full" style={{ background: i === authorityLineage.length - 1 ? "#CA8A04" : "#A8A29E" }} />
              <div className="font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: i === authorityLineage.length - 1 ? "#CA8A04" : "#78716C" }}>
                {PHASES[i] ?? "AHEAD"}
              </div>
              <div className="mt-1.5 text-[14px] leading-[1.7]" style={{ color: "#A8A29E" }}>{entry}</div>
            </div>
          ))}
          {/* AHEAD — the real referenced-but-missing concepts from the vault projection */}
          <div className="relative opacity-90">
            <span className="absolute -left-[31px] top-1 h-2 w-2 rounded-full border border-dashed" style={{ borderColor: "#78716C", background: "#1C1917" }} />
            <div className="font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: "#A8A29E" }}>
              AHEAD · STILL FORMING {emerging.length > 0 && <span style={{ color: "#57534E" }}>· from the vault</span>}
            </div>
            {emerging.length > 0 ? (
              <div className="mt-1.5 text-[14px] leading-[1.7]" style={{ color: "#A8A29E" }}>
                Shoots from this stem, referenced but not yet written:{" "}
                {emerging.map((e, i) => (
                  <span key={e.term}>
                    <i style={{ color: "#D6D3D1" }}>{e.term}</i> <span style={{ color: "#78716C" }}>({e.references}×)</span>
                    {i < emerging.length - 1 ? " · " : ""}
                  </span>
                ))}
                . The excavation continues.
              </div>
            ) : (
              <div className="mt-1.5 text-[14px] italic leading-[1.7]" style={{ color: "#A8A29E" }}>
                Two shoots from this stem. The excavation continues.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* what traveled — hand-authored */}
      <div>
        <div className="mb-3.5 font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: "#78716C" }}>
          WHAT HAS TRAVELED <span style={{ color: "#57534E" }}>· curated</span>
        </div>
        <div className="flex flex-col gap-3">
          {traveled.map((w) => (
            <div key={w.id} style={{ border: "1px solid #57534E", background: "#292524", padding: "18px 20px" }}>
              <div className="font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: "#A8A29E" }}>
                ✦ {(w.venue ?? "essay").toUpperCase()} · PUBLISHED
              </div>
              <div className="mt-1.5 font-serif text-[18px]" style={{ color: "#FAFAF9" }}>{w.title}</div>
              <div className="mt-1 text-[13px]" style={{ color: "#78716C" }}>{w.summary}</div>
            </div>
          ))}
          <div style={{ border: "1px solid #57534E", background: "#292524", padding: "18px 20px" }}>
            <div className="font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: "#65A30D" }}>✦ WHAT IT BECAME</div>
            <div className="mt-1.5 font-serif text-[18px]" style={{ color: "#FAFAF9" }}>{magnolia.title}</div>
            <div className="mt-1 text-[13px] leading-[1.6]" style={{ color: "#78716C" }}>{magnolia.summary}</div>
          </div>
        </div>
      </div>

      {/* lesson + question — hand-authored */}
      <div className="flex flex-col gap-3">
        <div style={{ border: "1px solid #44403C", background: "#232019", padding: "18px 20px" }}>
          <div className="font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: "#78716C" }}>LESSON · ❧</div>
          <div className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#A8A29E", textWrap: "pretty" }}>
            The essays written from the product outwrote the essays written from theory. The next first
            draft should begin with what Magnolia actually did.
          </div>
        </div>
        <div style={{ border: "1px dashed #57534E", padding: "18px 20px" }}>
          <div className="font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: "#A8A29E" }}>QUESTION LEFT OPEN → FORMATION</div>
          <div className="mt-2 text-[15px] italic leading-[1.75]" style={{ color: "#A8A29E", textWrap: "pretty" }}>
            {question.text} — already the seed of <i>Decision Memory</i>.
          </div>
        </div>
      </div>

      {/* living vocabulary — the canon, from the vault projection when present */}
      <div className="border-t pt-6" style={{ borderColor: "#44403C" }}>
        <div className="flex items-baseline gap-2 font-mono text-[11px] font-semibold tracking-[0.08em]" style={{ color: "#78716C" }}>
          <span>THE CANON · LIVING VOCABULARY</span>
          <span style={{ color: "#57534E" }}>· {canon[0]?.source === "vault" ? "from the vault" : "curated"}</span>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-2 text-[12px] font-medium">
          {canon.map((c) => (
            <span key={c.id} className="border px-3 py-1.5" style={{ borderColor: "#57534E", color: "#D6D3D1" }}>
              {c.title}
              {c.backlinks > 0 && <span style={{ color: "#78716C" }}> · {c.backlinks}</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
