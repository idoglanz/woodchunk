"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/misc";

// three.js and the editor load only on this page, in the browser.
const FrameEditor = dynamic(() => import("@/components/frame/frame-editor").then((m) => m.FrameEditor), {
  ssr: false,
  loading: () => <div className="p-6"><Skeleton className="h-[70dvh] w-full rounded-[16px]" /></div>,
});

export function FramePage({ assemblyId }: { assemblyId: string }) {
  return <FrameEditor assemblyId={assemblyId} />;
}
