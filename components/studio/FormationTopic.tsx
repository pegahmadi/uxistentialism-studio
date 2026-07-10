"use client";

import { useState } from "react";

// The emerging topic with its evidence case (Tab / click to fold) and a
// destination judgment honoring the Medium / Substack distinction.
export function FormationTopic() {
  const [caseOpen, setCaseOpen] = useState(false);
  const [approved, setApproved] = useState(false);

  return (
    <div className="overflow-hidden border border-ink bg-paper">
      <div className="px-6 pb-[18px] pt-6">
        <div className="flex items-baseline justify-between gap-4">
          <div className="font-serif text-[22px] leading-[1.4]">Decision Memory</div>
          <span className="flex-none border border-[#fef08a] bg-[#fefce8] px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.06em] text-amber">
            EMERGING TOPIC · READY
          </span>
        </div>
        <p className="mt-2.5 text-[15px] leading-[1.75] text-strong" style={{ textWrap: "pretty" }}>
          Systems forget <i>why</i>. The record of a choice — its reasoning and its authority — should be
          first-class, not a side effect. The question <i>Authority Architecture</i> left open, now
          answered by what you keep learning while building Magnolia.
        </p>
      </div>

      <button
        onClick={() => setCaseOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-[18px] border-t border-line bg-surface px-6 py-[13px] text-left text-[13px] text-strong hover:bg-surface2"
      >
        <span><b className="text-ink">6</b> signals</span>
        <span><b className="text-ink">3</b> recurring observations</span>
        <span><b className="text-ink">2</b> related essays</span>
        <span><b className="text-ink">2</b> open questions</span>
        <span><b className="text-ink">1</b> live debate</span>
        <span className="flex-1" />
        <span className="text-faint">{caseOpen ? "▴ fold" : "▾ open"} the case</span>
      </button>

      {caseOpen && (
        <div className="env-enter flex flex-col gap-3 border-t border-line px-6 py-[18px] text-[14px] leading-[1.7] text-strong">
          <div><b className="font-mono text-[11px] font-semibold tracking-[0.08em] text-strong">SIGNALS</b> — Cursor and AI code generation accelerating; MCP standardizing tool authority; design systems absorbing decisions.</div>
          <div><b className="font-mono text-[11px] font-semibold tracking-[0.08em] text-green">OBSERVATIONS</b> — Magnolia keeps proving that the decision, not the artifact, is the thing worth keeping.</div>
          <div><b className="font-mono text-[11px] font-semibold tracking-[0.08em] text-ink">CORPUS</b> — extends Governance Debt; closes the question Authority Architecture opened.</div>
          <div><b className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted">OPEN QUESTIONS</b> — what should the system remember? · does a record change who is accountable?</div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-4">
        <div className="text-[13px] leading-[1.65] text-strong">
          <b className="font-semibold text-ink">Destination: Substack, then Medium.</b> The founder&rsquo;s note first —
          how the idea surfaced while building Magnolia — then the framework essay once it can stand on its own.
        </div>
        <button
          onClick={() => setApproved(true)}
          className="flex-none border px-5 py-2.5 font-mono text-[13px] font-semibold hover:!border-strong hover:!bg-strong hover:!text-paper"
          style={{
            borderColor: "#78716c",
            background: approved ? "#78716c" : "transparent",
            color: approved ? "#fafaf9" : "#78716c",
          }}
        >
          {approved ? "✓ Approved" : "Approve ↵"}
        </button>
      </div>
    </div>
  );
}
