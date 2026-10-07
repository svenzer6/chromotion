import type { Accent } from '../types';

export const ACCENTS: Accent[] = ['blue', 'purple', 'green', 'orange', 'pink', 'cyan', 'red', 'yellow', 'grey'];

/** Display swatches tuned per theme; the names map 1:1 to chrome.tabGroups colors. */
export const ACCENT_SWATCH: Record<Accent, { light: string; dark: string; label: string }> = {
  grey: { light: '#6B7280', dark: '#9CA3AF', label: 'Grey' },
  blue: { light: '#1A6FE0', dark: '#5AA2FF', label: 'Blue' },
  red: { light: '#D93025', dark: '#FF7A70', label: 'Red' },
  yellow: { light: '#B07D00', dark: '#F5C542', label: 'Yellow' },
  green: { light: '#188038', dark: '#5BD083', label: 'Green' },
  pink: { light: '#C2185B', dark: '#FF7EB3', label: 'Pink' },
  purple: { light: '#7E3FF2', dark: '#B58CFF', label: 'Purple' },
  cyan: { light: '#00838F', dark: '#4DD6E3', label: 'Cyan' },
  orange: { light: '#C25400', dark: '#FFA057', label: 'Orange' },
};

export const nextAccent = (used: (Accent | undefined)[]): Accent => {
  const counts = new Map<Accent, number>(ACCENTS.map((a) => [a, 0]));
  for (const a of used) if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  let best = ACCENTS[0];
  for (const a of ACCENTS) if ((counts.get(a) ?? 0) < (counts.get(best) ?? 0)) best = a;
  return best;
};
