import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { ideasInMode } from "@/lib/placeholder";

const mode = getMode("formation")!;

export default function FormationPage() {
  const ideas = ideasInMode("formation");
  return (
    <div>
      <ModeHeader mode={mode} />
      <section className="flex flex-col gap-10">
        {ideas.map((idea) => (
          <article key={idea.id} className="border-l-2 border-line pl-6">
            <p className="text-xs uppercase tracking-wider text-muted">
              Working thesis
            </p>
            <h3 className="mt-2 font-serif text-2xl text-ink">{idea.title}</h3>
            <p className="mt-2 max-w-xl font-serif text-lg italic leading-relaxed text-muted">
              &ldquo;{idea.thesis}&rdquo;
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
