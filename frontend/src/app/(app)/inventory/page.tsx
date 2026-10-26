import type { Metadata } from "next";
import { InventoryPage } from "@/components/pages/inventory";

export const metadata: Metadata = { title: "Inventory" };

export default function Page() {
  return <InventoryPage />;
}
