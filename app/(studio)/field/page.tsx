import { FieldView } from "@/components/studio/FieldView";
import { getGraph, getGraphDetails } from "@/lib/projection";

export default function FieldPage() {
  const { nodes, edges } = getGraph();
  const details = getGraphDetails();
  return (
    <div className="flex h-full flex-col">
      <FieldView graphNodes={nodes} graphEdges={edges} details={details} />
    </div>
  );
}
