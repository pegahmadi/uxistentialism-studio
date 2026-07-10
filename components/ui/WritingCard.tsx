import type { Writing } from "@/lib/content";

// A piece of writing — an output of an idea, a snapshot of it at a moment.
export function WritingCard({ writing }: { writing: Writing }) {
  const meta = [
    writing.form === "series" ? "Series" : "Essay",
    writing.venue,
    writing.status,
  ].filter(Boolean);
  return (
    <article className="rounded-lg border border-line bg-white/40 p-5 transition-colors hover:border-ink/20">
      <p className="text-[0.7rem] uppercase tracking-wider text-muted">{meta.join(" · ")}</p>
      <h3 className="mt-2 font-serif text-xl leading-snug text-ink">{writing.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{writing.summary}</p>
    </article>
  );
}
