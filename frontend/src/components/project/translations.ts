"use client";

import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api/client";
import type { Lang } from "@/lib/i18n";

/** Make sure user-written names are translated (one cached AI call), then return the map. */
export function useTranslations(id: string, version: number, lang: Lang) {
  return useQuery({
    queryKey: ["translations", id, version, lang],
    enabled: lang !== "en",
    staleTime: Infinity,
    retry: false,
    queryFn: () => unwrap<Record<string, string>>(api.POST("/api/projects/{project_id}/translations", { params: { path: { project_id: id }, query: { lang } } })),
  });
}
