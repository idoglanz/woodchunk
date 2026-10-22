"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api, postForm, unwrap,
  type CatalogImport, type CatalogItem, type CatalogItemIn, type Conversation, type InventoryEntry, type Plan, type Prefs,
  type Project, type ProjectSummary, type Shopping, type Supplier, type TemplateSummary, type User,
} from "@/lib/api/client";
import { toast } from "@/lib/toast";

export const qk = {
  me: ["me"] as const,
  projects: (archived: boolean) => ["projects", archived] as const,
  project: (id: string) => ["project", id] as const,
  plan: (id: string, v: number, lang = "en", tr = 0) => ["plan", id, v, lang, tr] as const,
  shopping: (id: string, v: number, lang: string, tr = 0) => ["shopping", id, v, lang, tr] as const,
  catalog: (p: object) => ["catalog", p] as const,
  suppliers: ["suppliers"] as const,
  templates: ["templates"] as const,
  inventory: ["inventory"] as const,
  conversation: (id: string) => ["conversation", id] as const,
  imports: ["imports"] as const,
  import: (id: string) => ["import", id] as const,
  aiStatus: ["ai-status"] as const,
};

const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong.");

export function useMe(enabled = true) {
  return useQuery({ queryKey: qk.me, enabled, staleTime: 60_000, queryFn: () => unwrap<User>(api.GET("/api/me")) });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string | null; prefs: Prefs }) => unwrap<User>(api.PUT("/api/me", { body })),
    onSuccess: (u) => qc.setQueryData(qk.me, u),
    onError,
  });
}

export function useProjects(archived = false) {
  return useQuery({
    queryKey: qk.projects(archived),
    queryFn: () => unwrap<ProjectSummary[]>(api.GET("/api/projects", { params: { query: { archived } } })),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: qk.project(id),
    queryFn: () => unwrap<Project>(api.GET("/api/projects/{project_id}", { params: { path: { project_id: id } } })),
    staleTime: Infinity,
  });
}

export function usePlan(id: string, version: number, lang: "en" | "he" = "en", enabled = true, trStamp = 0) {
  return useQuery({
    queryKey: qk.plan(id, version, lang, trStamp),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    queryFn: () => unwrap<Plan>(api.GET("/api/projects/{project_id}/plan", { params: { path: { project_id: id }, query: { lang } } })),
  });
}

export function useShopping(id: string, version: number, lang: "en" | "he", enabled = true, trStamp = 0) {
  return useQuery({
    queryKey: qk.shopping(id, version, lang, trStamp),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => unwrap<Shopping>(api.GET("/api/projects/{project_id}/shopping", { params: { path: { project_id: id }, query: { lang } } })),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; description?: string; template_id?: string | null }) =>
      unwrap<Project>(api.POST("/api/projects", { body: { name: body.name ?? "Untitled project", description: body.description ?? "", template_id: body.template_id ?? null } })),
    onSuccess: (p) => { qc.setQueryData(qk.project(p.id), p); void qc.invalidateQueries({ queryKey: ["projects"] }); },
    onError,
  });
}

export function useProjectAction() {
  const qc = useQueryClient();
  const done = (p?: Project) => {
    if (p) qc.setQueryData(qk.project(p.id), p);
    void qc.invalidateQueries({ queryKey: ["projects"] });
  };
  return {
    duplicate: useMutation({
      mutationFn: (id: string) => unwrap<Project>(api.POST("/api/projects/{project_id}/duplicate", { params: { path: { project_id: id } } })),
      onSuccess: done, onError,
    }),
    archive: useMutation({
      mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
        unwrap<Project>(api.POST("/api/projects/{project_id}/archive", { params: { path: { project_id: id } }, body: { archived } })),
      onSuccess: done, onError,
    }),
    remove: useMutation({
      mutationFn: (id: string) => unwrap<void>(api.DELETE("/api/projects/{project_id}", { params: { path: { project_id: id } } })),
      onSuccess: () => done(), onError,
    }),
    status: useMutation({
      mutationFn: ({ id, status }: { id: string; status: Project["status"] }) =>
        unwrap<Project>(api.POST("/api/projects/{project_id}/status", { params: { path: { project_id: id } }, body: { status } })),
      onSuccess: (p) => { done(p); void qc.invalidateQueries({ queryKey: qk.inventory }); },
      onError,
    }),
  };
}

export function useCatalog(params: { q?: string; kind?: "lumber" | "sheet" | "hardware" | null; status?: "active" | "suggested" | "retired" | null; supplier_id?: string | null }, enabled = true) {
  return useQuery({
    queryKey: qk.catalog(params),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: () => unwrap<CatalogItem[]>(api.GET("/api/catalog", { params: { query: { q: params.q ?? "", kind: params.kind ?? undefined, status: params.status ?? undefined, supplier_id: params.supplier_id ?? undefined } } })),
  });
}

export function useSaveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CatalogItemIn }) =>
      id ? unwrap<CatalogItem>(api.PUT("/api/catalog/{item_id}", { params: { path: { item_id: id } }, body }))
        : unwrap<CatalogItem>(api.POST("/api/catalog", { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["catalog"] }),
    onError,
  });
}

export function useItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "suggested" | "retired" }) =>
      unwrap<CatalogItem>(api.POST("/api/catalog/{item_id}/status", { params: { path: { item_id: id } }, body: { status } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["catalog"] }),
    onError,
  });
}

export function useSuppliers() {
  return useQuery({ queryKey: qk.suppliers, staleTime: 300_000, queryFn: () => unwrap<Supplier[]>(api.GET("/api/suppliers")) });
}

export function useTemplates() {
  return useQuery({ queryKey: qk.templates, queryFn: () => unwrap<TemplateSummary[]>(api.GET("/api/templates")) });
}

export function useInventory() {
  return useQuery({ queryKey: qk.inventory, queryFn: () => unwrap<InventoryEntry[]>(api.GET("/api/workshop/inventory")) });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: qk.conversation(id),
    queryFn: () => unwrap<Conversation>(api.GET("/api/ai/projects/{project_id}/conversation", { params: { path: { project_id: id } } })),
  });
}

export function useAIStatus() {
  return useQuery({ queryKey: qk.aiStatus, staleTime: 120_000, queryFn: () => unwrap<{ enabled: boolean; calls_today: number }>(api.GET("/api/ai/status")) });
}

export function useImports() {
  return useQuery({ queryKey: qk.imports, queryFn: () => unwrap<CatalogImport[]>(api.GET("/api/ai/catalog/imports")) });
}

export function useImport(id: string) {
  return useQuery({
    queryKey: qk.import(id),
    queryFn: () => unwrap<CatalogImport>(api.GET("/api/ai/catalog/imports/{import_id}", { params: { path: { import_id: id } } })),
  });
}

export function startImport(form: FormData) {
  return postForm<CatalogImport>("/api/ai/catalog/import", form);
}
