import { useEffect, useState } from 'react';
import type { ThemePreference } from '../types';

/** Applies light/dark to <html>; "system" follows prefers-color-scheme live. */
export function useTheme(pref: ThemePreference | undefined) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || ((pref ?? 'system') === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [pref]);
}

/** Reactive "is the resolved theme dark" for per-theme accent swatches. */
export function useIsDark(): boolean {
  const read = () => document.documentElement.dataset.theme === 'dark';
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
