import Link from "next/link";
import { getTodayBriefing, type Evidence, type SyncProvenance } from "@/lib/today";
import { TodayActiveDraft } from "@/components/studio/TodayActiveDraft";

export const dynamic = "force-dynamic";

const link = "cursor-pointer border-b border-line2 text-ink hover:border-muted";

// Data-layer provenance (§8), in the same restrained mono language: live data
// names its last sync; fixture/curated data says so plainly; stale never hides.
function syncLabel(p: SyncProvenance): string {
  if (p.source === "live") {
    if (!p.lastSuccessfulSync) return "live · sync time unknown · stale";
    return p.stale ? `live · stale · last synced ${p.lastSuccessfulSync}` : `live · synced ${p.lastSuccessfulSync}`;
  }
  return p.source === "fallback" ? "fixture" : "curated";
}

// Structured provenance, shown in the same restrained mono language as the page
// eyebrows. Authored (Workspace) evidence reads a shade stronger than derived
// (projection/curated) evidence — the reader can always see where a line came from.
function Provenance({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[10.5px] tracking-[0.06em]">
      {evidence.map((e, i) => (
        <span key={i} className="flex items-center gap-2.5">
          {i > 0 && <span className="text-line2" aria-hidden>·</span>}
          <span className={e.derived ? "text-faint" : "text-muted"}>
            <span className="uppercase">{e.label}</span>
            {e.value && <span className="text-faint">{" · "}{e.value}</span>}
          </span>
        </span>
      ))}
    </div>
  );
}

export default async function TodayPage() {
  const b = await getTodayBriefing();

  const workspaceLive = b.sources.workspace === "file";
  const parts: string[] = [];
  if (workspaceLive) parts.push(`your Workspace${b.updated ? ` (updated ${b.updated.at}${b.updated.by ? ` · ${b.updated.by}` : ""})` : ""}`);
  parts.push(b.sources.projection === "vault" ? "the vault projection" : "the curated slice");
  if (b.sources.board === "editorial-board") parts.push("the Editorial Board");
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const sourceLine = workspaceLive ? `Drawn from ${joined}.` : `Drawn from ${joined} — no Workspace set yet.`;

  return (
    <div className="mx-auto max-w-[620px] px-9 pb-[72px] pt-[84px]">
      <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-faint">
        THIS MORNING · ◆ ORIENTS
      </div>
      <h1 className="mt-4 font-serif text-[30px] font-bold leading-[1.3] tracking-[-0.015em]">
        {b.question}
      </h1>

      <div
        className="mt-7 flex flex-col gap-[26px]"
        style={{ textWrap: "pretty" }}
      >
        {/* primary focus — an active Studio draft takes priority over the
            legacy Workspace manuscript; with no draft, this renders unchanged. */}
        <TodayActiveDraft
          fallback={
            b.focus ? (
              <div style={{ animation: "rise .7s ease .05s backwards" }}>
                <p className="text-[17px] leading-[1.8] text-ink">
                  {b.focus.href ? (
                    <>
                      {b.focus.text}{" "}
                      <Link href={b.focus.href} className={link}>
                        ↵
                      </Link>
                    </>
                  ) : (
                    b.focus.text
                  )}
                </p>
                <Provenance evidence={b.focus.evidence} />
              </div>
            ) : null
          }
        />

        {/* one field movement / emerging concept */}
        {b.movement && (
          <div style={{ animation: "rise .7s ease .18s backwards" }}>
            <p className="text-[17px] leading-[1.8] text-strong">
              {b.movement.text}
              {b.movement.href && (
                <>
                  {" "}
                  <Link href={b.movement.href} className={`${link} font-medium`}>
                    →
                  </Link>
                </>
              )}
            </p>
            <Provenance evidence={b.movement.evidence} />
          </div>
        )}

        {/* one open question */}
        {b.openQuestion && (
          <div style={{ animation: "rise .7s ease .3s backwards" }}>
            <p className="text-[15px] leading-[1.75] text-muted">
              The question underneath: <i className="text-strong">{b.openQuestion.text}</i>
            </p>
            <Provenance evidence={b.openQuestion.evidence} />
          </div>
        )}

        {/* one next action */}
        {b.action && (
          <div style={{ animation: "rise .7s ease .42s backwards" }}>
            <p className="text-[17px] leading-[1.8] text-strong">
              {b.action.href ? (
                <Link href={b.action.href} className={`${link} font-medium`}>
                  {b.action.text}
                </Link>
              ) : (
                b.action.text
              )}
            </p>
            <Provenance evidence={b.action.evidence} />
          </div>
        )}

        {/* optional short note from the Workspace */}
        {b.note && (
          <div style={{ animation: "rise .7s ease .5s backwards" }}>
            <p className="text-[15px] leading-[1.75] italic text-muted">{b.note.text}</p>
            <Provenance evidence={b.note.evidence} />
          </div>
        )}

        {/* honest sourcing — never claims activity it cannot support */}
        <p
          className="mt-1 font-mono text-[11px] tracking-[0.04em] text-faint"
          style={{ animation: "rise .7s ease .58s backwards" }}
        >
          {sourceLine}
        </p>
        {/* data-layer provenance — live / fixture / stale, never silent (§8) */}
        <p
          className="-mt-5 font-mono text-[10.5px] tracking-[0.04em] text-faint"
          style={{ animation: "rise .7s ease .62s backwards" }}
        >
          projection · {syncLabel(b.provenance.projection)} — board · {syncLabel(b.provenance.board)}
        </p>
        <p className="text-[15px] text-faint" style={{ animation: "rise .7s ease .66s backwards" }}>
          — ◆
        </p>
      </div>
    </div>
  );
}
