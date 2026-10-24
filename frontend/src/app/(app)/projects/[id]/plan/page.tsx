import { redirect } from "next/navigation";

// Design and Plan were merged into Build; keep old links working.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/build`);
}
