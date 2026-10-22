import { ProjectWorkspace } from "@/components/project/workspace";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectWorkspace id={id}>{children}</ProjectWorkspace>;
}
