/** The quiet line at the bottom of every page. */
export function Credit() {
  return (
    <footer className="no-print pb-[max(24px,env(safe-area-inset-bottom))] pt-2 text-center text-[12px] text-ink-3">
      Brought to you free by the Glanz workshop
    </footer>
  );
}
