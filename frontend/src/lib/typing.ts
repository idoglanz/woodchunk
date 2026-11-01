"use client";

import { useSyncExternalStore } from "react";

/** Focus is somewhere you type or pick from a list: no single-key shortcuts there. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return !!target.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="combobox"]');
}

/**
 * The key a single-letter shortcut means, lower-cased. A Latin letter is taken as typed (so
 * AZERTY and Dvorak keep their letters). Anything else on a letter key is that key's Latin
 * letter: on a Hebrew layout L types ך, and Q and W type / and '.
 */
export function shortcutKey(e: Pick<KeyboardEvent, "key" | "code">): string {
  if (e.key.length !== 1) return e.key;
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? m[1].toLowerCase() : e.key.toLowerCase();
}

/** A field that brings up the on-screen keyboard. */
function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "submit"].includes((el as HTMLInputElement).type);
}

function subscribe(cb: () => void) {
  // focusout fires before focus lands on the next field: check once it has.
  const later = () => setTimeout(cb, 0);
  window.addEventListener("focusin", cb);
  window.addEventListener("focusout", later);
  return () => {
    window.removeEventListener("focusin", cb);
    window.removeEventListener("focusout", later);
  };
}

/**
 * Someone is typing on a phone: the keyboard is up. Bars pinned to the bottom step aside then
 * (iPhone Safari moves them around the keyboard, where they cover the field being edited).
 */
export function useTypingOnPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth < 640 && isTextEntry(document.activeElement),
    () => false,
  );
}
