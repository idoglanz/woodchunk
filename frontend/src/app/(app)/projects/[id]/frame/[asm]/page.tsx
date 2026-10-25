import { FramePage } from "@/components/frame/frame-page";

export default async function Page({ params }: { params: Promise<{ asm: string }> }) {
  const { asm } = await params;
  return <FramePage assemblyId={asm} />;
}
