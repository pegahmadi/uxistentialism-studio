import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { ideasInMode } from "@/lib/placeholder";
import { IdeaCard } from "@/components/ui/IdeaCard";

const mode = getMode("today")!;

export default function TodayPage() {
  const ideas = ideasInMode("today");
  return (
    <div>
      <ModeHeader mode={mode} />
      <section>
        <p className="mb-8 max-w-xl font-serif text-lg leading-relaxed text-ink">
          A few ideas are asking for your attention. Nothing here is overdue —
          this is only where the work feels most alive right now.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      </section>
    </div>
  );
}
