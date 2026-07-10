import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { ideasInMode, writingInMode } from "@/lib/content";
import { WritingCard } from "@/components/ui/WritingCard";

const mode = getMode("iteration")!;

export default function IterationPage() {
  const ideas = ideasInMode("iteration");
  const writing = writingInMode("iteration");

  return (
    <div>
      <ModeHeader mode={mode} />

      <section className="flex flex-col gap-12">
        {ideas.map((idea) => (
          <article key={idea.id}>
            <h3 className="font-serif text-2xl text-ink">{idea.title}</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{idea.thesis}</p>
            {idea.lineage && (
              <ol className="mt-5 flex flex-col gap-3 border-l border-line pl-6">
                {idea.lineage.map((entry, i) => (
                  <li key={i} className="relative text-sm text-muted">
                    <span
                      className="absolute -left-[1.7rem] top-1.5 h-1.5 w-1.5 rounded-full bg-line"
                      aria-hidden
                    />
                    {entry}
                  </li>
                ))}
              </ol>
            )}
          </article>
        ))}
      </section>

      {writing.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">In revision</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {writing.map((w) => (
              <WritingCard key={w.id} writing={w} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
