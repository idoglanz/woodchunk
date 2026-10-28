"use client";

import { useSyncExternalStore } from "react";

/** Focus is somewhere you type or pick from a list: no single-key shortcuts there. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return !!target.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="combobox"]');
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
