import type { Mode } from "@/lib/modes";

// A consistent header for each mode: its relationship to time as an eyebrow,
// its name, and the question it answers. Reads entirely from the Mode record.
export function ModeHeader({ mode }: { mode: Mode }) {
  return (
    <header className="mb-12 border-b border-line pb-8">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">
        {mode.time}
      </p>
      <h1 className="mt-3 font-serif text-4xl tracking-tight text-ink md:text-5xl">
        {mode.label}
      </h1>
      <p className="mt-4 max-w-xl font-serif text-xl italic text-muted">
        {mode.question}
      </p>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        {mode.posture}
      </p>
    </header>
  );
}
