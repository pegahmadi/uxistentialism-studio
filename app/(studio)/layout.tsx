import { StudioShell } from "@/components/studio/StudioShell";

// All six modes share one persistent shell. The (studio) route group keeps them
// under a common frame without adding a segment to the URL.
export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StudioShell>{children}</StudioShell>;
}
