"use client";

import { Descope } from "@descope/nextjs-sdk";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Credit } from "@/components/shell/credit";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { AUTH_MODE, DESCOPE_FLOW_ID, useAuth } from "@/lib/auth";

export function SignIn() {
  const { ready, signedIn, devSignIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (ready && signedIn) router.replace(next.startsWith("/") ? next : "/");
  }, [ready, signedIn, router, next]);

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="flex w-full max-w-[400px] flex-col items-center gap-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <Logo size={56} />
            <div className="flex flex-col gap-1.5">
              <h1 className="text-[28px] font-bold tracking-[-0.02em]">Woodchunk</h1>
              <p className="text-[15px] text-ink-2">Know exactly what to buy and how to cut it.</p>
            </div>
          </div>
          <div className="w-full rounded-[20px] bg-surface p-6 shadow-[var(--shadow-card)] dark:border dark:border-line">
            {AUTH_MODE === "descope" ? (
              <Descope flowId={DESCOPE_FLOW_ID} theme="light" />
            ) : (
              <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (email.includes("@")) devSignIn(email); }}>
                <Field label="Email" htmlFor="email" hint="Local development: any email signs you in.">
                  <TextInput id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </Field>
                <Button type="submit" variant="primary">Continue</Button>
              </form>
            )}
          </div>
        </div>
      </div>
      <Credit />
    </div>
  );
}
