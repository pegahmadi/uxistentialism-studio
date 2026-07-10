import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { writingInMode, productsInMode, ideasInMode } from "@/lib/content";
import { WritingCard } from "@/components/ui/WritingCard";
import { ProductCard } from "@/components/ui/ProductCard";
import { IdeaCard } from "@/components/ui/IdeaCard";

const mode = getMode("memory")!;

export default function MemoryPage() {
  const writing = writingInMode("memory");
  const products = productsInMode("memory");
  const ideas = ideasInMode("memory");

  return (
    <div>
      <ModeHeader mode={mode} />

      <p className="mb-12 max-w-xl font-serif text-lg italic leading-relaxed text-muted">
        A finished piece is a frozen view of a living idea. Memory keeps the idea,
        not just the output.
      </p>

      <section className="mb-14">
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">What has traveled</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {writing.map((w) => (
            <WritingCard key={w.id} writing={w} />
          ))}
        </div>
      </section>

      <section className="mb-14">
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">What it became</h2>
        <div className="grid gap-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">Ideas that accumulated</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      </section>
    </div>
  );
}
