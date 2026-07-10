import type { Idea } from "@/lib/content";
import { getMode } from "@/lib/modes";

// The Idea is the primary object. Squared, hairline-bordered, serif title — the
// "present in" chips make an idea's cross-environment life visible.
export function IdeaCard({ idea }: { idea: Idea }) {
  return (
    <article className="border border-line bg-surface/50 p-5 transition-colors hover:border-line2">
      <h3 className="font-serif text-[19px] leading-snug text-ink">{idea.title}</h3>
      <p className="mt-2 text-[14px] leading-[1.7] text-strong">{idea.thesis}</p>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-faint">present in</span>
        {idea.presentIn.map((slug) => (
          <span key={slug} className="border border-line px-2 py-0.5 text-[11px] text-muted">
            {getMode(slug)?.label ?? slug}
          </span>
        ))}
      </div>
    </article>
  );
}
