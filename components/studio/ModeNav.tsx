"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODES } from "@/lib/modes";

// Navigation across the six modes. Movement is lateral and in any direction —
// this is not a stepper. The active mode is marked quietly, never urgently.
export function ModeNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Spaces" className="flex flex-col gap-0.5">
      {MODES.map((mode) => {
        const href = `/${mode.slug}`;
        const active = pathname === href;
        return (
          <Link
            key={mode.slug}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-2 transition-colors ${
              active
                ? "bg-ink/5 text-ink"
                : "text-muted hover:bg-ink/5 hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                  active ? "bg-accent" : "bg-transparent"
                }`}
                aria-hidden
              />
              <span className="font-serif text-lg leading-none">
                {mode.label}
              </span>
            </span>
            <span className="mt-1 block pl-[0.9rem] text-xs leading-snug text-muted">
              {mode.question}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
