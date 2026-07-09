import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { ideasInMode } from "@/lib/placeholder";

const mode = getMode("memory")!;

export default function MemoryPage() {
  const ideas = ideasInMode("memory");
  return (
    <div>
      <ModeHeader mode={mode} />
      <p className="mb-12 max-w-xl font-serif text-lg italic leading-relaxed text-muted">
        A finished piece is a frozen view of a living idea. Memory keeps the
        idea, not just the output.
      </p>
      <section className="flex flex-col gap-10">
        {ideas.map((idea) => (
          <article key={idea.id}>
            <h3 className="font-serif text-2xl text-ink">{idea.title}</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              {idea.thesis}
            </p>
            {idea.lineage && (
              <p className="mt-3 text-sm text-muted">
                {idea.lineage.length} recorded{" "}
                {idea.lineage.length === 1 ? "trace" : "traces"} of how it
                developed.
              </p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
