import { StudioShell } from "@/components/studio/StudioShell";

// Live-data layer (contract §6/§8): every Studio environment renders dynamically
// on each request and reads its data snapshot at request time — there is no
// route cache to invalidate after an ingestion write.
export const dynamic = "force-dynamic";

// All six modes share one persistent shell. The (studio) route group keeps them
// under a common frame without adding a segment to the URL.
export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StudioShell>{children}</StudioShell>;
}
