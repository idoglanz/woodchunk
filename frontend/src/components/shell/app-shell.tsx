"use client";

import { Hammer, LayoutGrid, LibraryBig, LogOut, Settings, Shield, Warehouse } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Credit } from "@/components/shell/credit";
import { initialsOf } from "@/components/ui/avatars";
import { Logo } from "@/components/shell/logo";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useMe } from "@/lib/queries";
import { ThemeSync, type Theme } from "@/lib/theme";

const NAV = [
  { href: "/", label: "Projects", icon: LayoutGrid, match: (p: string) => p === "/" || p.startsWith("/projects") },
  { href: "/catalog", label: "Catalog", icon: LibraryBig, match: (p: string) => p.startsWith("/catalog") },
  { href: "/templates", label: "Templates", icon: Hammer, match: (p: string) => p.startsWith("/templates") },
  { href: "/inventory", label: "Inventory", icon: Warehouse, match: (p: string) => p.startsWith("/inventory") },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { ready, signedIn, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe(ready && signedIn);

  useEffect(() => {
    if (ready && !signedIn) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [ready, signedIn, router, pathname]);

  if (!ready || !signedIn) {
    return <div className="flex min-h-dvh items-center justify-center"><Logo size={40} /></div>;
  }

  const user = me.data;
  const initials = initialsOf(user?.name || user?.email || "?");

  return (
    <div className="flex min-h-dvh flex-col">
      <ThemeSync theme={user?.prefs.theme as Theme | undefined} />
      <header className="no-print sticky z-30 border-b border-line backdrop-blur-xl backdrop-saturate-[1.8]"
        style={{ top: "env(safe-area-inset-top, 0px)", background: "color-mix(in srgb, var(--bg) 72%, transparent)" }}>
        <div className="flex h-[52px] items-center gap-6 ps-[max(16px,env(safe-area-inset-left))] pe-[max(16px,env(safe-area-inset-right))] sm:ps-6 sm:pe-6 lg:ps-8 lg:pe-8">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-[-0.01em]">
            <Logo />
            <span className="text-[17px]">Woodchunk</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}
                className={cn("rounded-lg px-3 py-1.5 text-[14px] font-medium transition-colors", n.match(pathname) ? "text-ink" : "text-ink-2 hover:text-ink")}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <Menu trigger={
              <button type="button" aria-label="Account" className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-[12px] font-semibold text-ink-2 hover:text-ink">
                {user ? initials : <Skeleton className="h-8 w-8 rounded-full" />}
              </button>
            }>
              <div className="px-2.5 pb-2 pt-1.5">
                <p className="text-[14px] font-semibold">{user?.name}</p>
                <p className="text-[12px] text-ink-2">{user?.email}</p>
              </div>
              <MenuSeparator />
              <div className="md:hidden">
                {NAV.map((n) => <MenuItem key={n.href} icon={<n.icon size={15} />} onSelect={() => router.push(n.href)}>{n.label}</MenuItem>)}
                <MenuSeparator />
              </div>
              <MenuItem icon={<Settings size={15} />} onSelect={() => router.push("/settings")}>Settings</MenuItem>
              {user?.role === "admin" ? <MenuItem icon={<Shield size={15} />} onSelect={() => router.push("/admin")}>Admin</MenuItem> : null}
              <MenuSeparator />
              <MenuItem icon={<LogOut size={15} />} onSelect={() => { signOut(); router.replace("/sign-in"); }}>Sign out</MenuItem>
            </Menu>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      {/* The frame editor fills the window: no footer under it. */}
      {pathname.includes("/frame/") || pathname.includes("/sketch/") ? null : <Credit />}
    </div>
  );
}

/** A page's content: the full width of the window, with side margins. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("w-full ps-[max(16px,env(safe-area-inset-left))] pe-[max(16px,env(safe-area-inset-right))] pb-24 pt-8 sm:ps-6 sm:pe-6 lg:ps-8 lg:pe-8", className)}>
      {children}
    </div>
  );
}
