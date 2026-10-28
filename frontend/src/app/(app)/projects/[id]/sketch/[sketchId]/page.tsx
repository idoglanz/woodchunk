import { SketchEditor } from "@/components/sketch/sketch-editor";

export default async function Page({ params }: { params: Promise<{ sketchId: string }> }) {
  const { sketchId } = await params;
  return <SketchEditor sketchId={sketchId} />;
}
