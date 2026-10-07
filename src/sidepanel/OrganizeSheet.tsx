import { ArrowRight, Cpu, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Favicon } from '../components/Favicon';
import type { SuggestionBatch } from '../chrome/messaging';
import { run } from '../hooks/useAppState';
import type { PersistedState } from '../types';

type Draft = {
  id: string;
  include: boolean;
  name: string;
  description?: string;
  existingCanvasId?: string;
  tabIds: string[];
  picked: Set<string>;
  expanded: boolean;
};

type Props = {
  batch: SuggestionBatch;
  state: PersistedState;
  onClose: () => void;
};

const PREVIEW = 5;

/** Review step: AI never moves tabs without an explicit confirmation here. */
export function OrganizeSheet({ batch, state, onClose }: Props) {
  const tabsById = useMemo(() => new Map(state.tabs.map((t) => [t.id, t])), [state.tabs]);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    batch.suggestions.map((s) => ({
      id: s.id,
      include: true,
      name: s.name,
      description: s.description,
      existingCanvasId: s.existingCanvasId,
      tabIds: s.tabIds,
      picked: new Set(s.tabIds),
      expanded: s.tabIds.length <= PREVIEW,
    })),
  );
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => previous?.focus?.();
  }, []);

  const update = (id: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const chosen = drafts.filter((d) => d.include && d.picked.size > 0 && d.name.trim());
  const tabCount = chosen.reduce((n, d) => n + d.picked.size, 0);

  const apply = async () => {
    onClose();
    await run({
      type: 'APPLY_SUGGESTIONS',
      suggestions: chosen.map((d) => ({
        name: d.name.trim(),
        description: d.description,
        existingCanvasId: d.existingCanvasId,
        tabIds: d.tabIds.filter((id) => d.picked.has(id)),
      })),
    });
  };

  const ignoreAll = () => {
    onClose();
    void run({ type: 'DISMISS_SUGGESTIONS' });
  };

  const source = batch.model ? `${batch.providerLabel} · ${batch.model}` : batch.providerLabel;

  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="organize-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="sheet-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 id="organize-title" style={{ flex: 1 }}>
              {drafts.length === 1 ? '1 suggested canvas' : `${drafts.length} suggested canvases`}
            </h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
          <p>
            <Cpu size={12} style={{ verticalAlign: '-2px' }} /> {source}
            {batch.fellBackToLocal && ' — cloud AI unavailable, used on-device grouping'}
          </p>
          {batch.errors.length > 0 && batch.fellBackToLocal && <p title={batch.errors.join('\n')}>{batch.errors[batch.errors.length - 1]}</p>}
        </div>

        <div className="sheet-body scroll">
          {drafts.map((d) => {
            const existing = state.canvases.find((c) => c.id === d.existingCanvasId);
            const shown = d.expanded ? d.tabIds : d.tabIds.slice(0, PREVIEW);
            return (
              <article key={d.id} className={`suggestion${d.include ? '' : ' off'}`}>
                <div className="suggestion-head">
                  <input
                    type="checkbox"
                    checked={d.include}
                    aria-label={`Include ${d.name}`}
                    onChange={(e) => update(d.id, { include: e.target.checked })}
                  />
                  {existing ? (
                    <strong style={{ flex: 1 }}>
                      <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /> {existing.name}
                    </strong>
                  ) : (
                    <input
                      className="input input-inline"
                      style={{ flex: 1 }}
                      value={d.name}
                      aria-label="Canvas name"
                      maxLength={60}
                      onChange={(e) => update(d.id, { name: e.target.value })}
                    />
                  )}
                  <span className={`badge${existing ? ' neutral' : ''}`}>{existing ? 'Add to existing' : 'New'}</span>
                  <button type="button" className="icon-btn sm" aria-label={`Ignore ${d.name}`} title="Ignore" onClick={() => update(d.id, { include: false })}>
                    <X size={14} />
                  </button>
                </div>
                <div className="suggestion-meta">
                  {d.picked.size} of {d.tabIds.length} tabs{d.description ? ` · ${d.description}` : ''}
                </div>
                <ul className="suggestion-tabs">
                  {shown.map((id) => {
                    const t = tabsById.get(id);
                    if (!t) return null;
                    return (
                      <li key={id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={d.picked.has(id)}
                            onChange={(e) => {
                              const picked = new Set(d.picked);
                              if (e.target.checked) picked.add(id);
                              else picked.delete(id);
                              update(d.id, { picked });
                            }}
                          />
                          <Favicon url={t.url} />
                          <span>{t.title || t.url}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {!d.expanded && (
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 16 }} onClick={() => update(d.id, { expanded: true })}>
                    Show all {d.tabIds.length}
                  </button>
                )}
              </article>
            );
          })}
        </div>

        <div className="sheet-footer">
          <button type="button" className="btn btn-ghost" onClick={ignoreAll}>
            Ignore all
          </button>
          <button type="button" className="btn btn-primary" disabled={chosen.length === 0} onClick={apply}>
            {chosen.length === 0 ? 'Nothing selected' : `Apply · ${tabCount} tab${tabCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
