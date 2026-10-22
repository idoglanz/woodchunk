import type { Metadata } from "next";
import { JoinPage } from "@/components/pages/join";

export const metadata: Metadata = { title: "Join project" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinPage token={token} />;
}
