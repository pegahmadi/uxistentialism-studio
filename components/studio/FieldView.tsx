"use client";

import { useEffect, useMemo, useState } from "react";
import { SIGNALS, ideasInMode, type GraphNode, type GraphEdge, type NodeKind } from "@/lib/content";
import type { NodeDetail } from "@/lib/projection";
import { IdeaCard } from "@/components/ui/IdeaCard";

const GRAPH_W = 960;
const GRAPH_H = 560;

const TYPE: Record<NodeKind, { fill: string; stroke: string; label: string; dash?: string }> = {
  concept: { fill: "#FEFCE8", stroke: "#CA8A04", label: "#CA8A04" },
  essay: { fill: "#1C1917", stroke: "#1C1917", label: "#1C1917" },
  product: { fill: "#F0FDF4", stroke: "#65A30D", label: "#4D7C0F" },
  signal: { fill: "#EFEDEB", stroke: "#78716C", label: "#57534E" },
  question: { fill: "#F5F5F4", stroke: "#78716C", label: "#57534E", dash: "4 3" },
};

const MOMENTUM: Record<string, { m: string; c: string }> = {
  cursor: { m: "accelerating", c: "#CA8A04" },
  mcp: { m: "converging", c: "#78716C" },
  "figma-automation": { m: "becoming precedent", c: "#78716C" },
  "ai-code-generation": { m: "echoing", c: "#78716C" },
  "design-systems-decision-systems-signal": { m: "recurring ×3", c: "#78716C" },
};

export function FieldView({
  graphNodes,
  graphEdges,
  details,
}: {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  details: Record<string, NodeDetail>;
}) {
  const [view, setView] = useState<"list" | "graph">("list");
  const [openSignal, setOpenSignal] = useState<number>(-1);
  const [selected, setSelected] = useState<string>(
    () => graphNodes.find((n) => n.kind === "concept")?.id ?? graphNodes[0]?.id ?? "",
  );
  const [hover, setHover] = useState<string | null>(null);

  const ideas = ideasInMode("field");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "g" || e.key === "G") setView((v) => (v === "list" ? "graph" : "list"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Radial placement by kind (distinct bands so concepts, products, essays, and
  // signals don't share a ring) followed by a deterministic relaxation pass that
  // pushes apart any nodes whose labels would collide.
  const layout = useMemo(() => {
    const W = GRAPH_W, H = GRAPH_H, cx = W / 2, cy = H / 2;
    const R: Record<NodeKind, number> = { concept: 150, product: 214, essay: 258, signal: 328, question: 352 };
    const OFF: Record<NodeKind, number> = { concept: 0.2, product: 1.15, essay: 0.5, signal: 0.15, question: 0.8 };
    const totals: Record<string, number> = {};
    graphNodes.forEach((n) => (totals[n.kind] = (totals[n.kind] || 0) + 1));
    const idx: Record<string, number> = {};
    const deg: Record<string, number> = {};
    graphEdges.forEach((e) => {
      deg[e.from] = (deg[e.from] || 0) + 1;
      deg[e.to] = (deg[e.to] || 0) + 1;
    });
    const pos: Record<string, { x: number; y: number; r: number }> = {};
    for (const n of graphNodes) {
      const i = (idx[n.kind] = (idx[n.kind] ?? -1) + 1);
      const t = totals[n.kind];
      const a = (i / t) * Math.PI * 2 + OFF[n.kind];
      const r = R[n.kind];
      const base = n.kind === "concept" ? 14 + (deg[n.id] || 0) * 1.4 : n.kind === "signal" ? 10 : n.kind === "question" ? 12 : 14;
      pos[n.id] = { x: cx + Math.cos(a) * r * 1.28, y: cy + Math.sin(a) * r, r: Math.min(base, 28) };
    }

    const ids = graphNodes.map((n) => n.id);
    for (let it = 0; it < 90; it++) {
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const A = pos[ids[a]], B = pos[ids[b]];
          const dx = B.x - A.x, dy = B.y - A.y;
          const d = Math.hypot(dx, dy) || 0.01;
          const min = A.r + B.r + 48; // room for labels
          if (d < min) {
            const push = ((min - d) / 2) * 0.6;
            const ux = dx / d, uy = dy / d;
            A.x -= ux * push;
            A.y -= uy * push;
            B.x += ux * push;
            B.y += uy * push;
          }
        }
      }
      for (const id of ids) {
        const p = pos[id];
        p.x = Math.max(p.r + 90, Math.min(W - p.r - 90, p.x));
        p.y = Math.max(p.r + 20, Math.min(H - p.r - 22, p.y));
      }
    }
    return pos;
  }, [graphNodes, graphEdges]);

  const adj = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    graphEdges.forEach((e) => {
      (m[e.from] ??= new Set()).add(e.to);
      (m[e.to] ??= new Set()).add(e.from);
    });
    return m;
  }, [graphEdges]);

  const sel = graphNodes.find((n) => n.id === selected) ?? graphNodes[0];
  const detail = details[sel?.id] ?? { stat: "", body: "", links: "" };

  return (
    <>
      <div className="flex flex-none items-center justify-between border-b border-line px-9 pb-4 pt-[22px]">
        <div>
          <div className="font-serif text-[22px] leading-[1.4]">The Field</div>
          <div className="mt-0.5 text-[13px] text-muted">what is happening in the world · {SIGNALS.length} signals gathering</div>
        </div>
        <div className="flex overflow-hidden border border-line2 text-[13px] font-semibold">
          <button onClick={() => setView("list")} className="cursor-pointer px-4 py-2" style={{ background: view === "list" ? "#78716c" : "transparent", color: view === "list" ? "#fafaf9" : "#78716c" }}>List</button>
          <button onClick={() => setView("graph")} className="cursor-pointer border-l border-line2 px-4 py-2" style={{ background: view === "graph" ? "#78716c" : "transparent", color: view === "graph" ? "#fafaf9" : "#78716c" }}>Graph · G</button>
        </div>
      </div>

      {view === "list" ? (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[680px] flex-col px-9 pb-[72px] pt-6">
            {SIGNALS.map((s, i) => {
              const mom = MOMENTUM[s.id] ?? { m: "in the field", c: "#78716c" };
              const open = openSignal === i;
              return (
                <div key={s.id} onClick={() => setOpenSignal(open ? -1 : i)} className="-mx-3 cursor-pointer border-b border-line px-3 py-[18px] hover:bg-surface" style={{ background: open ? "#f5f5f4" : "transparent" }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-baseline gap-2.5">
                      <span className="text-[11px] font-semibold tracking-[0.08em] text-strong">SIGNAL</span>
                      <span className="text-[11px] italic tracking-[0.04em]" style={{ color: mom.c }}>{mom.m}</span>
                    </span>
                    <span className="flex-none text-[13px] tracking-[0.01em] text-faint">the field · ongoing</span>
                  </div>
                  <div className="mt-[7px] font-serif text-[17px] leading-snug text-ink">{s.title}</div>
                  {open && (
                    <div className="env-enter">
                      <div className="mt-3 border-t border-line pt-3 text-[15px] leading-[1.7] text-strong">{s.note}</div>
                      <div className="mt-3 flex gap-2 text-[13px] font-medium">
                        <span className="cursor-pointer border border-line2 px-3.5 py-1.5 text-strong hover:bg-surface">Save to Formation</span>
                        <span className="cursor-pointer border border-line2 px-3.5 py-1.5 text-strong hover:bg-surface">Connect…</span>
                        <span className="cursor-pointer px-3.5 py-1.5 text-muted hover:bg-surface">Dismiss</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {ideas.map((idea) => (
              <div key={idea.id} className="mt-6">
                <IdeaCard idea={idea} />
              </div>
            ))}
            <div className="pt-[18px] text-center text-[13px] tracking-[0.01em] text-faint">the field runs continuously — older signals settle into the graph</div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="relative flex-1 overflow-hidden bg-surface">
            <svg viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full">
              {graphEdges.map((e, i) => {
                const a = layout[e.from], b = layout[e.to];
                if (!a || !b) return null;
                const touchesSel = e.from === selected || e.to === selected;
                const touchesHov = hover && (e.from === hover || e.to === hover);
                const na = graphNodes.find((n) => n.id === e.from);
                const nb = graphNodes.find((n) => n.id === e.to);
                const q = na?.kind === "question" || nb?.kind === "question";
                return (
                  <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={touchesHov ? "#CA8A04" : touchesSel ? "#A8A29E" : "#E7E5E4"}
                    strokeWidth={touchesHov ? 1.5 : 1}
                    strokeDasharray={q ? "3 3" : undefined}
                    opacity={hover && !touchesHov ? 0.2 : 1}
                    style={{ transition: "opacity .25s, stroke .25s" }} />
                );
              })}
              {graphNodes.map((n) => {
                const p = layout[n.id];
                const st = TYPE[n.kind];
                const isSel = n.id === selected;
                const dimmed = hover && hover !== n.id && !(adj[hover] && adj[hover].has(n.id));
                return (
                  <g key={n.id} style={{ cursor: "pointer", opacity: dimmed ? 0.22 : 1, transition: "opacity .25s" }}
                    onClick={() => setSelected(n.id)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                    <circle cx={p.x} cy={p.y} r={p.r} fill={st.fill} stroke={isSel ? "#1C1917" : st.stroke} strokeWidth={isSel ? 2 : 1.25} strokeDasharray={st.dash} />
                    <text x={p.x} y={p.y + p.r + 13} textAnchor="middle" fontSize={p.r >= 18 ? 13 : 11} fontWeight={isSel || p.r >= 20 ? 600 : 400} fill={isSel ? "#1C1917" : st.label}>{n.label}</text>
                  </g>
                );
              })}
            </svg>
            <div className="absolute bottom-3.5 left-4 flex gap-3.5 border border-line px-3 py-[7px] text-[11px] font-medium text-muted" style={{ background: "rgba(250,250,249,.9)" }}>
              <span><span className="text-amber">●</span> concept</span>
              <span><span className="text-ink">●</span> essay</span>
              <span><span className="text-green">●</span> product</span>
              <span><span style={{ color: "#78716c" }}>●</span> signal</span>
              <span><span style={{ color: "#78716c" }}>◌</span> question</span>
            </div>
          </div>
          <div className="w-[300px] flex-none overflow-y-auto border-l border-line bg-paper p-6">
            <div className="text-[11px] font-semibold tracking-[0.08em]" style={{ color: TYPE[sel?.kind ?? "concept"].label }}>{(sel?.kind ?? "").toUpperCase()}</div>
            <div className="mt-2 font-serif text-[19px] leading-[1.4]">{sel?.label}</div>
            <div className="mt-[7px] text-[11px] font-medium italic tracking-[0.04em] text-faint">{detail.stat}</div>
            <div className="mt-3 text-[14px] leading-[1.7] text-strong">{detail.body}</div>
            {detail.links && <div className="mt-4 border-t border-line pt-3.5 text-[13px] leading-[1.7] text-muted">{detail.links}</div>}
          </div>
        </div>
      )}
    </>
  );
}
