import type { Metadata } from "next";
import { ProjectsHome } from "@/components/home/projects-home";

export const metadata: Metadata = { title: "Projects" };

export default function Home() {
  return <ProjectsHome />;
}
