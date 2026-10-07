import { ACCENTS, ACCENT_SWATCH } from '../lib/colors';
import type { Accent } from '../types';

export function ColorSwatches({ value, dark, onPick }: { value?: Accent; dark: boolean; onPick: (a: Accent) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Canvas color">
      {ACCENTS.map((a) => (
        <button
          key={a}
          type="button"
          role="menuitemradio"
          className="swatch"
          aria-checked={value === a}
          aria-label={ACCENT_SWATCH[a].label}
          title={ACCENT_SWATCH[a].label}
          style={{ '--dot': ACCENT_SWATCH[a][dark ? 'dark' : 'light'] } as React.CSSProperties}
          onClick={() => onPick(a)}
        />
      ))}
    </div>
  );
}
