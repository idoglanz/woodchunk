"use client";

import { createContext, useContext } from "react";
import type { Plan, User } from "@/lib/api/client";
import type { Units } from "@/lib/units";

export type ProjectCtx = {
  id: string;
  units: Units;
  readOnly: boolean;
  me: User | undefined;
  plan: Plan | undefined;
  planFetching: boolean;
  aiOpen: boolean;
  openAI: () => void;
  closeAI: () => void;
};

export const ProjectContext = createContext<ProjectCtx | null>(null);

export function useProjectCtx(): ProjectCtx {
  const c = useContext(ProjectContext);
  if (!c) throw new Error("useProjectCtx outside ProjectWorkspace");
  return c;
}
