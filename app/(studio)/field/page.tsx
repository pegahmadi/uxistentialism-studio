import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { signalsInMode, ideasInMode } from "@/lib/content";
import { IdeaCard } from "@/components/ui/IdeaCard";

const mode = getMode("field")!;

export default function FieldPage() {
  const signals = signalsInMode("field");
  const ideas = ideasInMode("field");

  return (
    <div>
      <ModeHeader mode={mode} />

      <section className="mb-14">
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">Signals</h2>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {signals.map((s) => (
            <li key={s.id} className="py-4">
              <p className="font-serif text-lg text-ink">{s.title}</p>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{s.note}</p>
            </li>
          ))}
        </ul>
      </section>

      {ideas.length > 0 && (
        <section>
          <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">Ideas forming from the field</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {ideas.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
