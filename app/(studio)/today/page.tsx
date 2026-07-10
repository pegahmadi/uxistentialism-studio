import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { ideasInMode, productsInMode, writingInMode, questionsInMode } from "@/lib/content";
import { IdeaCard } from "@/components/ui/IdeaCard";
import { WritingCard } from "@/components/ui/WritingCard";
import { ProductCard } from "@/components/ui/ProductCard";

const mode = getMode("today")!;

export default function TodayPage() {
  const ideas = ideasInMode("today");
  const products = productsInMode("today");
  const writing = writingInMode("today");
  const questions = questionsInMode("today");

  return (
    <div>
      <ModeHeader mode={mode} />

      <p className="mb-8 max-w-xl font-serif text-lg leading-relaxed text-ink">
        A few threads are alive right now. Nothing here is overdue — this is only
        where attention is best spent today.
      </p>

      <section className="mb-14">
        <div className="grid gap-4 sm:grid-cols-2">
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      </section>

      {questions.length > 0 && (
        <section className="mb-14">
          <h2 className="mb-3 text-xs uppercase tracking-[0.18em] text-muted">Open questions</h2>
          <ul className="flex flex-col gap-2">
            {questions.map((q) => (
              <li key={q.id} className="font-serif text-lg italic text-muted">
                {q.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">In the workshop</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
          {writing.map((w) => (
            <WritingCard key={w.id} writing={w} />
          ))}
        </div>
      </section>
    </div>
  );
}
