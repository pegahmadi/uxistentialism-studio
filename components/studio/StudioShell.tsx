"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MODES, isModeSlug, type ModeSlug } from "@/lib/modes";
import { SIGNALS, writingInMode } from "@/lib/content";

// The persistent frame shared by all six environments. It gives the app its
// IDE-for-thinking feel: a marks-and-badges sidebar, a mono status strip, a ⌘K
// palette, and keyboard navigation — wrapped around the existing routed pages.

const BADGES: Record<ModeSlug, string> = {
  today: "",
  field: String(SIGNALS.length),
  formation: "forming",
  iteration: "",
  distribution: String(writingInMode("distribution").length),
  memory: "",
};

const CONTEXT: Record<ModeSlug, string> = {
  today: "the present · esc → today",
  field: "signals · g for graph",
  formation: "what is worth writing",
  iteration: "manuscript · in review",
  distribution: "medium leads · substack follows",
  memory: "the accumulated past",
};

const DIRECTIVE: Record<ModeSlug, string> = {
  today: "the field moved toward you overnight",
  field: "decision memory is gathering",
  formation: "one idea is crossing the threshold",
  iteration: "strengthen the mechanism",
  distribution: "medium leads, substack follows",
  memory: "two shoots are still forming",
};

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sbOpen, setSbOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const slug: ModeSlug = (() => {
    const seg = pathname.split("/").filter(Boolean)[0] ?? "today";
    return isModeSlug(seg) ? seg : "today";
  })();
  const dark = slug === "memory";
  const activeIdx = MODES.findIndex((m) => m.slug === slug);

  const go = (s: ModeSlug) => {
    setPaletteOpen(false);
    router.push(`/${s}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const editing = !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        if (paletteOpen) setPaletteOpen(false);
        else if (el?.isContentEditable) el.blur();
        else router.push("/today");
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (editing || e.metaKey || e.ctrlKey || e.altKey) return;
      const jump = { "1": "today", "2": "field", "3": "formation", "4": "iteration", "5": "distribution", "6": "memory" }[e.key];
      if (jump) go(jump as ModeSlug);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen]);

  const sbBg = dark ? "#1c1917" : "#f5f5f4";
  const sbBorder = dark ? "#44403c" : "#e7e5e4";
  const sbInk = dark ? "#fafaf9" : "#1c1917";
  const sbFaint = dark ? "#78716c" : "#a8a29e";

  return (
    <div className="flex h-full w-full" style={{ background: dark ? "#1c1917" : "#fafaf9" }}>
      {/* ── sidebar ── */}
      <aside
        className="flex flex-none flex-col overflow-hidden"
        style={{
          width: sbOpen ? 212 : 52,
          background: sbBg,
          borderRight: `1px solid ${sbBorder}`,
          transition: "width .25s cubic-bezier(.22,.75,.3,1)",
        }}
      >
        <div className="flex flex-none items-center gap-2.5 pl-5 pt-4 pb-3.5">
          <span
            className="grid h-5 w-5 flex-none place-items-center font-serif text-[10px] font-bold"
            style={{ border: `1px solid ${sbInk}`, color: sbInk }}
          >
            U
          </span>
          <span
            className="whitespace-nowrap text-[11px] font-semibold tracking-[0.08em] transition-opacity"
            style={{ color: sbFaint, opacity: sbOpen ? 1 : 0 }}
          >
            UXISTENTIALISM
          </span>
        </div>

        <nav className="flex flex-none flex-col gap-px px-2 py-1.5" aria-label="Environments">
          {MODES.map((m) => {
            const here = m.slug === slug;
            return (
              <button
                key={m.slug}
                onClick={() => go(m.slug)}
                title={m.question}
                className="flex cursor-pointer items-center gap-[11px] px-3 py-2 text-left"
                style={{ background: here ? (dark ? "#292524" : "#efedeb") : "transparent" }}
              >
                <span
                  className="w-[13px] flex-none text-center font-mono text-[11px]"
                  style={{ color: here ? "#ca8a04" : sbFaint }}
                >
                  {m.mark}
                </span>
                <span
                  className="whitespace-nowrap text-[13px] transition-opacity"
                  style={{
                    fontWeight: here ? 600 : 400,
                    color: here ? sbInk : dark ? "#a8a29e" : "#57534e",
                    opacity: sbOpen ? 1 : 0,
                  }}
                >
                  {m.label}
                </span>
                <span className="flex-1" />
                <span
                  className="whitespace-nowrap font-mono text-[9px] transition-opacity"
                  style={{ color: sbFaint, opacity: sbOpen ? 1 : 0 }}
                >
                  {BADGES[m.slug]}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex flex-none flex-col gap-px px-2 py-3">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex cursor-pointer items-center gap-[11px] px-3 py-2 text-left"
          >
            <span className="w-[13px] flex-none text-center font-mono text-[10px]" style={{ color: sbFaint }}>⌘</span>
            <span className="whitespace-nowrap text-[12.5px]" style={{ color: sbFaint, opacity: sbOpen ? 1 : 0 }}>Command · ⌘K</span>
          </button>
          <button
            onClick={() => setSbOpen((v) => !v)}
            className="flex cursor-pointer items-center gap-[11px] px-3 py-2 text-left"
          >
            <span className="w-[13px] flex-none text-center font-mono text-[10px]" style={{ color: sbFaint }}>{sbOpen ? "‹" : "›"}</span>
            <span className="whitespace-nowrap text-[12.5px]" style={{ color: sbFaint, opacity: sbOpen ? 1 : 0 }}>Collapse</span>
          </button>
        </div>
      </aside>

      {/* ── main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex-1 overflow-hidden">
          <div key={pathname} className="env-enter absolute inset-0 overflow-y-auto">
            {children}
          </div>
        </div>

        {/* ── status strip ── */}
        <div
          className="flex h-7 flex-none select-none items-center justify-between px-4 font-mono text-[10px] tracking-[0.04em]"
          style={{
            borderTop: `1px solid ${dark ? "#44403c" : "#e7e5e4"}`,
            background: dark ? "#1c1917" : "#f5f5f4",
            color: dark ? "#a8a29e" : "#57534e",
          }}
        >
          <div className="flex items-center gap-3.5">
            <span className="font-semibold">{MODES[activeIdx].label.toUpperCase()}</span>
            <span className="opacity-65">{CONTEXT[slug]}</span>
          </div>
          <div className="flex items-center gap-3.5">
            <span className="opacity-50" title="the six environments">
              {MODES.map((_, i) => (i === activeIdx ? "●" : "○")).join(" ")}
            </span>
            <span className="cursor-pointer text-[#ca8a04]" style={{ animation: "breathe 3s ease infinite" }}>● {DIRECTIVE[slug]}</span>
            <button onClick={() => setPaletteOpen(true)} className="cursor-pointer opacity-55 hover:opacity-100">⌘K</button>
          </div>
        </div>
      </div>

      {/* ── command palette ── */}
      {paletteOpen && (
        <div
          onClick={() => setPaletteOpen(false)}
          className="absolute inset-0 z-50 flex justify-center pt-28"
          style={{ background: "rgba(28,25,23,.4)", animation: "veil .16s ease" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="h-fit w-[560px] overflow-hidden border border-[#d6d3d1] bg-[#fafaf9]"
            style={{ animation: "settle .2s ease" }}
          >
            <div className="border-b border-[#e7e5e4] px-5 py-4 text-[15px] text-[#a8a29e]">
              Go anywhere, ask anything&nbsp;
              <span className="inline-block h-[15px] w-px align-[-2px]" style={{ background: "#78716c", animation: "caret 1.1s infinite" }} />
            </div>
            <div className="flex flex-col py-1.5 text-[15px]">
              {MODES.map((m, i) => (
                <button
                  key={m.slug}
                  onClick={() => go(m.slug)}
                  className="flex cursor-pointer justify-between px-5 py-[11px] text-left hover:bg-[#f5f5f4]"
                >
                  <span>
                    <span className="font-mono text-[11px] text-[#78716c]">{m.mark}</span>
                    &nbsp;&nbsp;{m.label} — {m.question.toLowerCase()}
                  </span>
                  <span className="font-mono text-[11px] text-[#a8a29e]">{i + 1}</span>
                </button>
              ))}
              <div className="mx-5 my-1.5 border-t border-[#e7e5e4]" />
              <div className="flex justify-between px-5 py-[11px] text-[14px] text-[#a8a29e]">
                <span>Ask a companion · connect a signal · show a lineage…</span>
                <span className="font-mono text-[11px] text-[#d6d3d1]">soon</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
