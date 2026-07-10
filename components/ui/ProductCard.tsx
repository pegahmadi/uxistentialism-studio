import type { Product } from "@/lib/content";

// A product — an idea that has accumulated into something built.
export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="rounded-lg border border-line bg-white/40 p-6 transition-colors hover:border-ink/20">
      <p className="text-[0.7rem] uppercase tracking-wider text-muted">Product · Case study</p>
      <h3 className="mt-2 font-serif text-2xl text-ink">{product.title}</h3>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{product.summary}</p>
    </article>
  );
}
