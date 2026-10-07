import { ExternalLink, RefreshCw } from 'lucide-react';

export const AUTHOR = { name: 'Burhan Celebi', email: 'drburhancelebi@icloud.com' };

const logoUrl = () => (globalThis.chrome?.runtime?.id ? chrome.runtime.getURL('icons/logo-mark.svg') : '../icons/logo-mark.svg');

export function Backdrop() {
  return <div className="backdrop" aria-hidden="true" />;
}

export function LogoMark({ className, size }: { className?: string; size?: number }) {
  return <img className={className} src={logoUrl()} width={size} height={size} alt="" />;
}

export function Signature() {
  return (
    <div className="signature">
      <LogoMark />
      <span>
        Chromotion · by{' '}
        <a href={`mailto:${AUTHOR.email}`} title={AUTHOR.email}>
          {AUTHOR.name}
        </a>
      </span>
    </div>
  );
}

/**
 * Shown when a page is opened outside the extension (e.g. double-clicking
 * dist/sidepanel/index.html) or the background never answers.
 */
export function HelpScreen({ reason }: { reason: 'not-installed' | 'no-response' }) {
  return (
    <div className="standalone">
      <Backdrop />
      <div className="card">
        <LogoMark size={52} />
        {reason === 'not-installed' ? (
          <>
            <h1>Chromotion is a Chrome extension</h1>
            <p style={{ color: 'var(--text-2)' }}>This page only works inside Chrome after the extension is installed. / Bu sayfa yalnızca eklenti kurulduktan sonra Chrome içinde çalışır.</p>
            <ol>
              <li>
                Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong>.
              </li>
              <li>
                Unzip <code>chromotion-*.zip</code> into a folder (do not load the zip itself).
              </li>
              <li>
                Click <strong>Load unpacked</strong> and choose the folder that contains <code>manifest.json</code>.
              </li>
              <li>Click the Chromotion icon in the toolbar (pin it from the puzzle menu).</li>
            </ol>
          </>
        ) : (
          <>
            <h1>Chromotion is starting…</h1>
            <p style={{ color: 'var(--text-2)' }}>
              The background service did not answer. Reloading the extension usually fixes this. / Arka plan servisi yanıt vermedi; eklentiyi yeniden yüklemek genelde çözer.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={() => chrome.runtime.reload()}>
                <RefreshCw size={15} /> Reload extension
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => chrome.runtime.openOptionsPage()}>
                <ExternalLink size={15} /> Diagnostics
              </button>
            </div>
          </>
        )}
        <p className="note">
          Chromotion · by {AUTHOR.name} · <a href={`mailto:${AUTHOR.email}`}>{AUTHOR.email}</a>
        </p>
      </div>
    </div>
  );
}
