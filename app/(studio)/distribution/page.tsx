import { getMode } from "@/lib/modes";
import { ModeHeader } from "@/components/studio/ModeHeader";
import { ideasInMode } from "@/lib/placeholder";

const mode = getMode("distribution")!;

// Illustrative only — nothing here publishes anywhere.
const CHANNELS = ["Essay", "Newsletter", "Talk", "Thread"];

export default function DistributionPage() {
  const ideas = ideasInMode("distribution");
  return (
    <div>
      <ModeHeader mode={mode} />
      <section className="flex flex-col gap-6">
        {ideas.map((idea) => (
          <article
            key={idea.id}
            className="rounded-lg border border-line p-5"
          >
            <h3 className="font-serif text-xl text-ink">{idea.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {idea.thesis}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-line px-3 py-1 text-xs text-muted"
                >
                  {c}
                </span>
              ))}
            </div>
          </article>
        ))}
        <p className="mt-2 text-xs text-muted">
          Channels are illustrative — no publishing is wired up.
        </p>
      </section>
    </div>
  );
}
