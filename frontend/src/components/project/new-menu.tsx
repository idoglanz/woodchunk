"use client";

import { Box, Layers, PencilRuler, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TemplateDialog } from "@/components/frame/template-dialog";
import { useProjectCtx } from "@/components/project/context";
import { useNewSketch } from "@/components/sketch/sketch-card";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/overlay";
import { newAssembly, nextLetter, useEditor } from "@/lib/editor";

/** Start something new in the project from anywhere in it: a sketch, a 3D frame or an assembly. */
export function NewMenu() {
  const { id } = useProjectCtx();
  const router = useRouter();
  const readOnly = useEditor((s) => s.readOnly);
  const edit = useEditor((s) => s.edit);
  const newSketch = useNewSketch();
  const [frame, setFrame] = useState(false);
  if (readOnly) return null;
  const addAssembly = () => {
    edit((d) => { d.assemblies.push(newAssembly({ letter: nextLetter(d.assemblies.map((a) => a.letter)), name: `Assembly ${d.assemblies.length + 1}` })); });
    router.push(`/projects/${id}/build`);
  };
  return (
    <>
      {/* Icon only on phones, where the header is tight. */}
      <Menu trigger={<Button size="sm" variant="ghost" aria-label="New" title="New sketch, 3D frame or assembly" className="max-sm:w-8 max-sm:px-0" icon={<Plus size={15} strokeWidth={2.4} />}><span className="hidden sm:inline">New</span></Button>}>
        <MenuItem icon={<PencilRuler size={16} />} onSelect={newSketch}>Sketch</MenuItem>
        <MenuItem icon={<Box size={16} />} onSelect={() => setFrame(true)}>3D frame</MenuItem>
        <MenuItem icon={<Layers size={16} />} onSelect={addAssembly}>Assembly</MenuItem>
      </Menu>
      {frame ? <TemplateDialog open={frame} onOpenChange={setFrame} /> : null}
    </>
  );
}
