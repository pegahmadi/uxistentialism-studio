import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { writingInMode, productsInMode } from "@/lib/content";
import { WritingCard } from "@/components/ui/WritingCard";
import { ProductCard } from "@/components/ui/ProductCard";

const mode = getMode("distribution")!;

export default function DistributionPage() {
  const writing = writingInMode("distribution");
  const products = productsInMode("distribution");

  return (
    <div>
      <ModeHeader mode={mode} />

      <section className="mb-14">
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">Writing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {writing.map((w) => (
            <WritingCard key={w.id} writing={w} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-muted">Products</h2>
        <div className="grid gap-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <p className="text-xs text-muted">
        Nothing here publishes anywhere — Distribution is a view, not an integration.
      </p>
    </div>
  );
}
