import { FieldView } from "@/components/studio/FieldView";
import { getResearchBrief } from "@/lib/field-research";
import { getGraph, getGraphDetails, getProjection } from "@/lib/projection";

export const dynamic = "force-dynamic";

// Data-layer provenance (§8) in the Studio's restrained mono language.
function provenanceLabel(source: "live" | "fallback" | "default", lastSuccessfulSync: string | null, stale: boolean): string {
  if (source === "live") {
    if (!lastSuccessfulSync) return "vault · live · sync time unknown · stale";
    return stale ? `vault · live · stale · last synced ${lastSuccessfulSync}` : `vault · live · synced ${lastSuccessfulSync}`;
  }
  return source === "fallback" ? "vault · fixture" : "curated";
}

export default async function FieldPage() {
  // Snapshot rule (§8): one projection snapshot; graph and details derive from it.
  const projection = await getProjection();
  const { nodes, edges } = getGraph(projection);
  const details = getGraphDetails(projection);
  // One research snapshot per request (§8) — sample data in v1, labelled as such in the UI.
  const research = await getResearchBrief();
  return (
    <div className="relative flex h-full flex-col">
      <FieldView graphNodes={nodes} graphEdges={edges} details={details} researchBrief={research.data} researchSource={research.source} />
      {/* data-layer provenance — live / fixture / stale, never silent (§8) */}
      <div className="pointer-events-none absolute bottom-2 right-4 font-mono text-[10px] tracking-[0.06em] text-faint">
        {provenanceLabel(projection.source, projection.lastSuccessfulSync, projection.stale)}
      </div>
    </div>
  );
}
