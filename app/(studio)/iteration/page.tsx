import { getIterationView } from "@/lib/iteration";
import { IterationClient } from "@/components/studio/IterationClient";

export const dynamic = "force-dynamic";

// Iteration answers "What still needs judgment?" — and is now also where the
// writing happens. The board snapshot is read on the server (§8 provenance
// intact); the manuscript itself is browser-local and owned by the client.
export default async function IterationPage() {
  const view = await getIterationView();
  return <IterationClient view={view} />;
}
