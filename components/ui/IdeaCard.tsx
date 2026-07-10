import type { Idea } from "@/lib/content";
import { getMode } from "@/lib/modes";

// The Idea is the primary object, so it gets a first-class component. The
// "present in" chips make the cross-mode nature of an idea visible: the same
// idea can appear in several spaces at once.
export function IdeaCard({ idea }: { idea: Idea }) {
  return (
    <article className="rounded-lg border border-line bg-white/40 p-5 transition-colors hover:border-ink/20">
      <h3 className="font-serif text-xl text-ink">{idea.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{idea.thesis}</p>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[0.7rem] uppercase tracking-wider text-muted">
          Present in
        </span>
        {idea.presentIn.map((slug) => (
          <span
            key={slug}
            className="rounded-full border border-line px-2 py-0.5 text-[0.7rem] text-muted"
          >
            {getMode(slug)?.label ?? slug}
          </span>
        ))}
      </div>
    </article>
  );
}
