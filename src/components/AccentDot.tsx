import { ACCENT_SWATCH } from '../lib/colors';
import type { Accent } from '../types';

export const accentColor = (accent: Accent | undefined, dark: boolean) =>
  ACCENT_SWATCH[accent ?? 'grey'][dark ? 'dark' : 'light'];

export function AccentDot({ accent, dark }: { accent?: Accent; dark: boolean }) {
  return <span className="dot" style={{ '--dot': accentColor(accent, dark) } as React.CSSProperties} aria-hidden="true" />;
}
