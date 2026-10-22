import type { Metadata } from "next";
import { AdminPage } from "@/components/pages/admin";

export const metadata: Metadata = { title: "Admin" };

export default function Page() {
  return <AdminPage />;
}
