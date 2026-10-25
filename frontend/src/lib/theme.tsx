"use client";

import { useLayoutEffect } from "react";

export type Theme = "system" | "light" | "dark";
export const THEME_KEY = "wc.theme";

/** Inline script for <head>: applies the saved theme before first paint. */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export function applyTheme(t: Theme) {
  try {
    if (t === "system") {
      localStorage.removeItem(THEME_KEY);
      document.documentElement.removeAttribute("data-theme");
    } else {
      localStorage.setItem(THEME_KEY, t);
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch {}
}

/** Keeps <html data-theme> in sync (also re-applies after dev Strict Mode remounts). */
export function ThemeSync({ theme }: { theme?: Theme }) {
  useLayoutEffect(() => {
    if (theme) applyTheme(theme);
    else {
      try {
        const t = localStorage.getItem(THEME_KEY);
        if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
      } catch {}
    }
  }, [theme]);
  return null;
}
