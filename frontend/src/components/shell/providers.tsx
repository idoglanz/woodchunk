"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TipProvider } from "@/components/ui/overlay";
import { ApiError } from "@/lib/api/client";
import { AuthRoot } from "@/lib/auth";
import { ThemeSync } from "@/lib/theme";

let browserClient: QueryClient | undefined;

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}

function getClient() {
  if (typeof window === "undefined") return makeClient();
  browserClient ??= makeClient();
  return browserClient;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getClient()}>
      <AuthRoot>
        <TipProvider>
          <ThemeSync />
          {children}
          <Toaster />
        </TipProvider>
      </AuthRoot>
    </QueryClientProvider>
  );
}
