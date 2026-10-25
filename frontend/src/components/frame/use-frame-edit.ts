import { useCallback } from "react";
import type { Assembly, CatalogItem } from "@/lib/api/client";
import { useEditor } from "@/lib/editor";
import { deriveParts } from "@/lib/frame/parts";
import type { Frame } from "@/lib/frame/types";

/**
 * Change an assembly's frame through the project editor (autosave, undo), regenerating its parts
 * in the same step so the Build tab and the cutting plan follow along. `key` merges a burst of
 * edits (typing a dimension) into one undo step.
 */
export function useFrameEdit(assemblyId: string, byId: Map<string, CatalogItem>) {
  const edit = useEditor((s) => s.edit);
  return useCallback((fn: (frame: Frame, asm: Assembly) => void, key?: string) => {
    edit((d) => {
      const a = d.assemblies.find((x) => x.id === assemblyId);
      if (!a?.frame) return;
      fn(a.frame as Frame, a);
      deriveParts(a, byId);
    }, key);
  }, [edit, assemblyId, byId]);
}
