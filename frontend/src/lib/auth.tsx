"use client";

import { AuthProvider as DescopeProvider } from "@descope/nextjs-sdk";
import { getSessionToken, useDescope, useSession } from "@descope/nextjs-sdk/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { configureAuth } from "@/lib/api/client";

export const DESCOPE_PROJECT_ID = process.env.NEXT_PUBLIC_DESCOPE_PROJECT_ID ?? "";
export const AUTH_MODE: "descope" | "dev" = DESCOPE_PROJECT_ID ? "descope" : "dev";
// The Descope project is shared with zizi-tripo; each app has its own branded flow.
export const DESCOPE_FLOW_ID = process.env.NEXT_PUBLIC_DESCOPE_FLOW_ID || "sign-up-or-in";
const DEV_KEY = "wc.devToken";

type AuthState = {
  ready: boolean;
  signedIn: boolean;
  signOut: () => void;
  devSignIn: (email: string) => void;
};

const AuthContext = createContext<AuthState>({ ready: false, signedIn: false, signOut: () => {}, devSignIn: () => {} });

export function useAuth() {
  return useContext(AuthContext);
}

function readDevToken(): string | null {
  try {
    return localStorage.getItem(DEV_KEY);
  } catch {
    return null;
  }
}

const devListeners = new Set<() => void>();

function subscribeDev(cb: () => void) {
  devListeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === DEV_KEY) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { devListeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

function writeDevToken(t: string | null) {
  try {
    if (t) localStorage.setItem(DEV_KEY, t);
    else localStorage.removeItem(DEV_KEY);
  } catch {}
  devListeners.forEach((l) => l());
}

// Registered at import time, not in an effect: child components' first requests run in
// effects that fire before any provider effect, and would otherwise go out unauthenticated.
if (typeof window !== "undefined") {
  if (AUTH_MODE === "dev") configureAuth(readDevToken, () => writeDevToken(null));
  else configureAuth(() => getSessionToken() || null, () => {});
}

function DevAuth({ children }: { children: ReactNode }) {
  // undefined = not known yet (server render / hydration), null = signed out.
  const token = useSyncExternalStore(subscribeDev, readDevToken, () => undefined);
  const signOut = useCallback(() => writeDevToken(null), []);

  const devSignIn = useCallback((email: string) => {
    writeDevToken(`dev:${email.trim().toLowerCase()}`);
  }, []);

  const value = useMemo(() => ({ ready: token !== undefined, signedIn: !!token, signOut, devSignIn }), [token, signOut, devSignIn]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function DescopeBridge({ children }: { children: ReactNode }) {
  const { isAuthenticated, isSessionLoading } = useSession();
  const sdk = useDescope();
  const signOut = useCallback(() => {
    void sdk.logout();
  }, [sdk]);

  useEffect(() => {
    // Token getter is registered at import; here we only wire sign-out for 401s.
    configureAuth(() => getSessionToken() || null, signOut);
  }, [signOut]);

  const value = useMemo(
    () => ({ ready: !isSessionLoading, signedIn: isAuthenticated, signOut, devSignIn: () => {} }),
    [isSessionLoading, isAuthenticated, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthRoot({ children }: { children: ReactNode }) {
  if (AUTH_MODE === "descope") {
    return (
      <DescopeProvider projectId={DESCOPE_PROJECT_ID}>
        <DescopeBridge>{children}</DescopeBridge>
      </DescopeProvider>
    );
  }
  return <DevAuth>{children}</DevAuth>;
}
