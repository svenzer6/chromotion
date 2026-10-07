import { ArrowDown, ArrowUp, Download, ExternalLink, History, Loader2, Plus, Trash2, Upload, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { send, type BackupListItem, type Diagnostics, type ProviderTestResult } from '../chrome/messaging';
import { AUTHOR, Backdrop, LogoMark } from '../components/Brand';
import { Toasts } from '../components/Toasts';
import { backupFileName } from '../features/backup/BackupService';
import { originPattern, presetById, PROVIDER_PRESETS } from '../features/ai/catalog';
import { run, toast, useApp } from '../hooks/useAppState';
import { useTheme } from '../hooks/useTheme';
import { uid } from '../lib/id';
import type { AiProviderConfig, Preferences } from '../types';

const download = (text: string, filename: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function OptionsApp() {
  const state = useApp((s) => s.state);
  useTheme(state?.preferences.theme);

  if (!state) {
    return (
      <div className="options">
        <Backdrop />
        <div className="empty" style={{ height: '100%' }}>
          Loading…
        </div>
      </div>
    );
  }
  const prefs = state.preferences;
  const save = (patch: Partial<Preferences>) => run({ type: 'UPDATE_PREFERENCES', patch });

  return (
    <div className="options">
      <Backdrop />
      <div className="options-shell">
        <nav className="options-nav glass" aria-label="Settings sections">
          <div className="options-brand">
            <LogoMark />
            <strong>Chromotion</strong>
            <span>by {AUTHOR.name}</span>
          </div>
          <a href="#appearance">Appearance</a>
          <a href="#behavior">Behavior</a>
          <a href="#ai">AI</a>
          <a href="#privacy">Privacy</a>
          <a href="#backup">Backup & restore</a>
          <a href="#shortcuts">Shortcuts</a>
          <a href="#about">About & diagnostics</a>
        </nav>

        <main>
          <section id="appearance">
            <h2>Appearance</h2>
            <p className="lead">Light and dark are tuned separately; System follows your OS.</p>
            <div className="card">
              <div className="setting">
                <div className="setting-text">
                  <strong>Theme</strong>
                </div>
                <Segmented
                  label="Theme"
                  value={prefs.theme}
                  onChange={(theme) => save({ theme })}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                />
              </div>
            </div>
          </section>

          <section id="behavior">
            <h2>Behavior</h2>
            <p className="lead">How canvases map onto Chrome tabs.</p>
            <div className="card">
              <div className="setting">
                <div className="setting-text">
                  <strong>When switching canvas</strong>
                  <span>Collapse keeps other canvases loaded as collapsed tab groups. Unload closes them and reopens on return (saves memory).</span>
                </div>
                <Segmented
                  label="Switch mode"
                  value={prefs.switchMode}
                  onChange={(switchMode) => save({ switchMode })}
                  options={[
                    { value: 'collapse', label: 'Collapse others' },
                    { value: 'unload', label: 'Unload others' },
                  ]}
                />
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Mirror canvases as Chrome tab groups</strong>
                  <span>Each canvas gets a named, coloured group. Renaming a group in Chrome renames the canvas.</span>
                </div>
                <Switch label="Tab groups" checked={prefs.groupTabs} onChange={(groupTabs) => save({ groupTabs })} />
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Lazy-load reopened tabs</strong>
                  <span>Sleeping tabs load only when you look at them.</span>
                </div>
                <Switch label="Lazy load" checked={prefs.lazyLoadRestoredTabs} onChange={(lazyLoadRestoredTabs) => save({ lazyLoadRestoredTabs })} />
              </div>
              <div className="setting">
                <div className="setting-text">
                  <strong>Suggest a canvas for new tabs</strong>
                  <span>On-device only. Shows a small “Move to …?” prompt; never moves tabs by itself.</span>
                </div>
                <Switch label="New tab suggestions" checked={prefs.suggestForNewTabs} onChange={(suggestForNewTabs) => save({ suggestForNewTabs })} />
              </div>
            </div>
          </section>

          <AiSection prefs={prefs} save={save} />
          <PrivacySection />
          <BackupSection />

          <section id="shortcuts">
            <h2>Shortcuts</h2>
            <div className="card">
              <table className="table">
                <tbody>
                  {[
                    ['Open side panel', 'Alt+Shift+C (change in Chrome)'],
                    ['Command palette', 'Ctrl/⌘ + K  or  /'],
                    ['Switch to canvas 1–9', 'Alt + 1…9'],
                    ['Undo', 'Ctrl/⌘ + Z'],
                    ['Rename canvas', 'F2'],
                    ['Move canvas up / down', 'Alt + ↑ / ↓'],
                    ['Tabs: open / select / close', 'Enter / Space / Delete'],
                    ['Extend selection', 'Shift + ↑ / ↓'],
                  ].map(([a, k]) => (
                    <tr key={a}>
                      <td>{a}</td>
                      <td style={{ color: 'var(--text-3)' }}>{k}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row-buttons">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
                  <ExternalLink size={14} /> Change shortcuts
                </button>
              </div>
            </div>
          </section>

          <AboutSection />
        </main>
      </div>
      <Toasts />
    </div>
  );
}

// ---------------------------------------------------------------------------

function AiSection({ prefs, save }: { prefs: Preferences; save: (p: Partial<Preferences>) => unknown }) {
  const providers = prefs.ai.providers;
  const [adding, setAdding] = useState('ollama');
  const setProviders = (next: AiProviderConfig[]) => save({ ai: { ...prefs.ai, providers: next } });

  const add = async () => {
    const preset = presetById(adding);
    const config: AiProviderConfig = {
      id: uid(),
      presetId: preset.id,
      label: preset.label,
      kind: 'openai-compatible',
      baseUrl: preset.baseUrl,
      enabled: true,
    };
    const origin = originPattern(config.baseUrl);
    // Access to a local server is requested only when you add it.
    if (origin && !(await chrome.permissions.request({ origins: [origin] }))) {
      toast('Permission declined — the model was not added.', { kind: 'error' });
      return;
    }
    await setProviders([...providers, config]);
  };

  return (
    <section id="ai">
      <h2>AI</h2>
      <p className="lead">
        Free and open source: no account, no API key, no cloud. Grouping and naming run on this device. If you like, connect an open-source
        model running on your own computer for smarter suggestions — Chromotion still works fully without it.
      </p>
      <div className="card">
        <div className="setting">
          <div className="setting-text">
            <strong>Use a local model when available</strong>
            <span>Off = on-device heuristics only. Local models are tried top to bottom; if none answers, heuristics are used.</span>
          </div>
          <Switch label="Local model" checked={prefs.ai.enabled} onChange={(enabled) => save({ ai: { ...prefs.ai, enabled } })} />
        </div>
        {providers.map((p, i) => (
          <ProviderCard
            key={p.id}
            config={p}
            first={i === 0}
            last={i === providers.length - 1}
            onChange={(patch) => setProviders(providers.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))}
            onRemove={() => setProviders(providers.filter((x) => x.id !== p.id))}
            onMove={(dir) => {
              const next = [...providers];
              const j = i + dir;
              [next[i], next[j]] = [next[j], next[i]];
              void setProviders(next);
            }}
          />
        ))}
        <div className="setting">
          <div className="setting-text">
            <strong>Connect a local model</strong>
            <span>{presetById(adding).note}</span>
          </div>
          <select className="input" style={{ width: 'auto' }} value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Local server">
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" onClick={() => void add()}>
            <Plus size={15} /> Add
          </button>
        </div>
      </div>
      <p className="note">Only servers on this computer (localhost) can be connected, so your tabs never leave your machine.</p>
    </section>
  );
}

function ProviderCard({
  config,
  first,
  last,
  onChange,
  onRemove,
  onMove,
}: {
  config: AiProviderConfig;
  first: boolean;
  last: boolean;
  onChange: (p: Partial<AiProviderConfig>) => unknown;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const preset = presetById(config.presetId);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model ?? '');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: true; r: ProviderTestResult } | { ok: false; error: string }>();

  const commitBaseUrl = async () => {
    if (baseUrl === config.baseUrl) return;
    const origin = originPattern(baseUrl);
    if (!origin) {
      toast('Use a server on this computer, e.g. http://localhost:8080/v1', { kind: 'error' });
      return;
    }
    if (!(await chrome.permissions.request({ origins: [origin] }))) return;
    await onChange({ baseUrl });
  };

  const test = async () => {
    setTesting(true);
    setResult(undefined);
    const origin = originPattern(config.baseUrl);
    if (origin && !(await chrome.permissions.contains({ origins: [origin] })) && !(await chrome.permissions.request({ origins: [origin] }))) {
      setTesting(false);
      setResult({ ok: false, error: 'Permission not granted' });
      return;
    }
    try {
      const r = await send({ type: 'TEST_PROVIDER', provider: { ...config, model: model || undefined } });
      setResult({ ok: true, r });
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    setTesting(false);
  };

  return (
    <div className="provider">
      <div className="provider-head">
        <Switch label={`Enable ${config.label}`} checked={config.enabled} onChange={(enabled) => onChange({ enabled })} />
        <strong>{config.label}</strong>
        <a className="btn btn-ghost btn-sm" href={preset.docsUrl} target="_blank" rel="noreferrer">
          Setup guide <ExternalLink size={13} />
        </a>
        <button type="button" className="icon-btn sm" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}>
          <ArrowUp size={15} />
        </button>
        <button type="button" className="icon-btn sm" aria-label="Move down" disabled={last} onClick={() => onMove(1)}>
          <ArrowDown size={15} />
        </button>
        <button type="button" className="icon-btn sm" aria-label={`Remove ${config.label}`} onClick={onRemove}>
          <Trash2 size={15} />
        </button>
      </div>
      <div className="provider-grid">
        <div className="field">
          <label htmlFor={`url-${config.id}`}>Server address</label>
          <input
            id={`url-${config.id}`}
            className="input"
            placeholder="http://localhost:11434/v1"
            value={baseUrl}
            spellCheck={false}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => void commitBaseUrl()}
          />
        </div>
        <div className="field">
          <label htmlFor={`model-${config.id}`}>Model</label>
          <input
            id={`model-${config.id}`}
            className="input"
            placeholder="Auto — first loaded chat model"
            value={model}
            spellCheck={false}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => model !== (config.model ?? '') && onChange({ model: model.trim() || undefined })}
          />
        </div>
      </div>
      <div className="note">{preset.note}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={testing} onClick={() => void test()}>
          {testing ? <Loader2 size={14} className="spin" /> : <Zap size={14} />} Test
        </button>
        {result?.ok && (
          <span className="status-ok" role="status">
            Works · {result.r.model} · “{result.r.sampleName}” · {result.r.latencyMs} ms
          </span>
        )}
        {result && !result.ok && (
          <span className="status-err" role="status">
            {result.error}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PrivacySection() {
  return (
    <section id="privacy">
      <h2>Privacy</h2>
      <p className="lead">Chromotion has no server, no account, no analytics and no tracking.</p>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Where it goes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Canvases, tabs, settings, backups</td>
              <td>This browser’s local extension storage only</td>
            </tr>
            <tr>
              <td>Grouping, naming, search, new-tab suggestions</td>
              <td className="status-ok">Computed on this device</td>
            </tr>
            <tr>
              <td>Tab title, hostname and URL path (no query string)</td>
              <td>Only to a local model you connected yourself (localhost)</td>
            </tr>
            <tr>
              <td>Cookies, form contents, passwords, page content, history</td>
              <td className="status-err">Never read</td>
            </tr>
          </tbody>
        </table>
        <p className="note" style={{ padding: '0 16px 16px', margin: 0 }}>
          Favicons come from Chrome’s own cache. The source code is open (MIT license) — you can verify all of this yourself.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function BackupSection() {
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const jsonInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const refresh = () => void run({ type: 'LIST_BACKUPS' }, { quiet: true }).then((b) => b && setBackups(b));
  useEffect(refresh, []);

  const exportAs = async (format: 'json' | 'csv') => {
    const res = await run({ type: 'EXPORT', format });
    if (res) download(res.text, backupFileName(format), format === 'json' ? 'application/json' : 'text/csv;charset=utf-8');
  };

  const importFile = async (file: File | undefined, format: 'json' | 'csv') => {
    if (!file) return;
    const text = await file.text();
    if (format === 'json') {
      if (!confirm('Replace all canvases with this backup? Your current workspace is saved as a local snapshot first and can be undone.')) return;
      const r = await run({ type: 'IMPORT_JSON', text });
      if (r) toast(`Restored ${r.canvases} canvases and ${r.tabs} tabs`);
    } else {
      const r = await run({ type: 'IMPORT_CSV', text });
      if (r) toast(`Imported ${r.tabs} tabs, ${r.canvases} new canvases${r.skippedDuplicates ? ` · ${r.skippedDuplicates} duplicates skipped` : ''}`);
    }
    refresh();
  };

  return (
    <section id="backup">
      <h2>Backup & restore</h2>
      <p className="lead">
        Your workspace is saved automatically after every change (crash-safe journal in browser storage). Files below are extra, portable copies:
        JSON is lossless, CSV is human-readable.
      </p>
      <div className="card">
        <div className="row-buttons">
          <button type="button" className="btn btn-secondary" onClick={() => void exportAs('json')}>
            <Download size={15} /> Export JSON
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void exportAs('csv')}>
            <Download size={15} /> Export CSV
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => jsonInput.current?.click()}>
            <Upload size={15} /> Restore JSON…
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => csvInput.current?.click()}>
            <Upload size={15} /> Import CSV…
          </button>
          <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(e) => void importFile(e.target.files?.[0], 'json').finally(() => (e.target.value = ''))} />
          <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => void importFile(e.target.files?.[0], 'csv').finally(() => (e.target.value = ''))} />
        </div>
        <h3 style={{ padding: '0 16px' }}>
          <History size={14} style={{ verticalAlign: '-2px' }} /> Local snapshots
        </h3>
        <table className="table">
          <tbody>
            {backups.length === 0 && (
              <tr>
                <td style={{ color: 'var(--text-3)' }}>No snapshots yet — one is taken every 30 minutes when something changed.</td>
              </tr>
            )}
            {backups.map((b) => (
              <tr key={b.id}>
                <td>
                  {new Date(b.createdAt).toLocaleString()}
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {b.reason} · {b.canvasCount} canvases · {b.tabCount} tabs
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      if (!confirm('Restore this snapshot? The current workspace is snapshotted first.')) return;
                      await run({ type: 'RESTORE_BACKUP', backupId: b.id });
                      toast('Workspace restored');
                      refresh();
                    }}
                  >
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-buttons">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await run({ type: 'CREATE_BACKUP' });
              refresh();
              toast('Snapshot saved');
            }}
          >
            Take snapshot now
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function AboutSection() {
  const [diag, setDiag] = useState<Diagnostics>();
  const load = () => void run({ type: 'DIAGNOSTICS' }, { quiet: true }).then((d) => d && setDiag(d));
  useEffect(load, []);

  const report = diag
    ? [
        `Chromotion ${diag.version}`,
        diag.browser,
        `canvases=${diag.canvases} tabs=${diag.tabs} open=${diag.openTabs} storage=${diag.storageBytes}B`,
        ...diag.errors.map((e) => `${new Date(e.at).toISOString()} [${e.where}] ${e.message}`),
      ].join('\n')
    : '';

  return (
    <section id="about">
      <h2>About & diagnostics</h2>
      <div className="card">
        <div className="about">
          <LogoMark />
          <div>
            <strong>Chromotion</strong>
            <div className="by">
              Designed & built by {AUTHOR.name} · <a href={`mailto:${AUTHOR.email}`}>{AUTHOR.email}</a>
            </div>
            <div className="note" style={{ marginTop: 4 }}>
              Version {diag?.version ?? chrome.runtime.getManifest().version} · Calm, AI-assisted canvases for your tabs.
            </div>
          </div>
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <h3>Diagnostics</h3>
          <p className="note" style={{ marginTop: 0 }}>
            If something does not work on a computer, copy this report and send it to {AUTHOR.email}. It contains no tab titles or URLs.
          </p>
          <pre className="code">{report || '…'}</pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!report}
              onClick={() => void navigator.clipboard.writeText(report).then(() => toast('Report copied'))}
            >
              Copy report
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
              Refresh
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
