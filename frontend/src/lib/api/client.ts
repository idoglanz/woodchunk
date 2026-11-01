import createClient, { type Middleware } from "openapi-fetch";
import { createTranslator } from "use-intl";
import { en, he } from "@/messages";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];
export type Project = Schemas["Project"];
export type ProjectContent = Pick<Project, "name" | "description" | "settings" | "assemblies" | "extras" | "sketches">;
export type Assembly = Schemas["Assembly-Output"];
export type Part = Schemas["Part-Output"];
export type HardwareLine = Schemas["HardwareLine-Output"];
export type CuttingSettings = Schemas["CuttingSettings-Output"];
export type CatalogItem = Schemas["CatalogItemOut"];
export type CatalogItemIn = Schemas["CatalogItemIn"];
export type Supplier = Schemas["Supplier"];
export type Plan = Schemas["PlanOut"];
export type LumberPlan = Schemas["LumberPlan"];
export type SheetPlan = Schemas["SheetPlan"];
export type Shopping = Schemas["ShoppingOut"];
export type User = Schemas["User"];
export type Prefs = Schemas["Prefs-Output"];
export type ProjectSummary = Schemas["ProjectSummary"];
export type TemplateSummary = Schemas["TemplateSummary"];
export type InventoryEntry = Schemas["InventoryOut"];
export type Conversation = Schemas["Conversation"];
export type Proposal = Schemas["Proposal"];
export type CatalogImport = Schemas["CatalogImport"];

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

let tokenGetter: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

export function configureAuth(getToken: () => string | null, unauthorized: () => void) {
  tokenGetter = getToken;
  onUnauthorized = unauthorized;
}

export function authHeader(): Record<string, string> {
  const t = tokenGetter();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const auth: Middleware = {
  onRequest({ request }) {
    const t = tokenGetter();
    if (t) request.headers.set("Authorization", `Bearer ${t}`);
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401) onUnauthorized();
    return response;
  },
};

export const api = createClient<paths>({ baseUrl: API_URL });
api.use(auth);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Unwrap an openapi-fetch result, throwing ApiError with the server's message. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (error !== undefined || !response.ok) {
    throw new ApiError(response.status, errorMessage(error, response.status));
  }
  return data as T;
}

export function errorMessage(error: unknown, status?: number): string {
  const t = errorsTranslator();
  if (error && typeof error === "object" && "detail" in error) {
    const d = (error as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d[0]?.msg) return t("badInput", { msg: d[0].msg });
  }
  if (status === 503) return t("aiBusy");
  if (status && status >= 500) return t("server");
  return t("offline");
}

/** Errors are made outside React: they follow the page's language, which <html lang> carries. */
function errorsTranslator() {
  const lang = typeof document !== "undefined" && document.documentElement.lang === "he" ? "he" : "en";
  return createTranslator({ locale: lang, messages: (lang === "he" ? he : en) as typeof en, namespace: "common.errors" });
}

/** Multipart / raw requests that openapi-fetch doesn't type well. */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { method: "POST", body: form, headers: authHeader() });
  if (r.status === 401) onUnauthorized();
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, errorMessage(body, r.status));
  return body as T;
}

export async function download(path: string, filename: string) {
  const r = await fetch(`${API_URL}${path}`, { headers: authHeader() });
  if (!r.ok) throw new ApiError(r.status, errorMessage(await r.json().catch(() => null), r.status));
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
