import { useEffect, useRef } from 'react';

/** Bind a global shortcut like "mod+k" (mod = Ctrl, or ⌘ on macOS). */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts.at(-1);
    const needMod = parts.includes('mod');
    const needShift = parts.includes('shift');
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.defaultPrevented) return;
      const keyMatch = e.key.toLowerCase() === key || e.code === `Key${key?.toUpperCase()}`;
      if (keyMatch && mod === needMod && e.shiftKey === needShift && !e.altKey) {
        e.preventDefault();
        ref.current(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, enabled]);
}
