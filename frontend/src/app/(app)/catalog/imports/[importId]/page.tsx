import type { Metadata } from "next";
import { ImportReview } from "@/components/catalog/import-review";

export const metadata: Metadata = { title: "Review import" };

export default async function Page({ params }: { params: Promise<{ importId: string }> }) {
  const { importId } = await params;
  return <ImportReview id={importId} />;
}
