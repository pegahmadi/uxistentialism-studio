import Link from "next/link";
import { ModeNav } from "./ModeNav";

// The persistent frame shared by all six modes. A quiet sidebar holds the
// wordmark and the mode navigation; the main column gives ideas room to breathe.
export function StudioShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col md:flex-row">
      <aside className="shrink-0 border-line px-6 py-8 md:sticky md:top-0 md:h-screen md:w-72 md:border-r">
        <Link href="/today" className="mb-10 block">
          <span className="block font-serif text-xl tracking-tight text-ink">
            UXistentialism
          </span>
          <span className="mt-0.5 block text-xs uppercase tracking-[0.18em] text-muted">
            Studio
          </span>
        </Link>
        <ModeNav />
        <p className="mt-10 max-w-[16rem] text-xs leading-relaxed text-muted">
          An operating system for intellectual work. Spaces are modes of
          thinking, not folders — an idea moves between them freely.
        </p>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-10 md:px-12 md:py-16">
        {children}
      </main>
    </div>
  );
}
