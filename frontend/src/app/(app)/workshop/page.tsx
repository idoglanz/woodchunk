import type { Metadata } from "next";
import { WorkshopPage } from "@/components/pages/workshop";

export const metadata: Metadata = { title: "Workshop" };

export default function Page() {
  return <WorkshopPage />;
}
