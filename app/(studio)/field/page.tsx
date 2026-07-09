import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { ideasInMode, OBSERVATIONS } from "@/lib/placeholder";
import { IdeaCard } from "@/components/ui/IdeaCard";

const mode = getMode("field")!;

export default function FieldPage() {
  const ideas = ideasInMode("field");
  return (
    <div>
      <ModeHeader mode={mode} />

      <section className="mb-14">
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">
          Observations
        </h2>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {OBSERVATIONS.map((o) => (
            <li key={o.id} className="flex flex-col gap-1 py-4">
              <p className="font-serif text-lg text-ink">{o.note}</p>
              <p className="text-xs uppercase tracking-wider text-muted">
                {o.source}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">
          Ideas forming from the field
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      </section>
    </div>
  );
}
