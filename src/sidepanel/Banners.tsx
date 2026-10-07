import { ArrowRightLeft, LifeBuoy, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { run, useApp } from '../hooks/useAppState';
import type { PersistedState } from '../types';

type Props = {
  state: PersistedState;
  sheetOpen: boolean;
  organizing: boolean;
  onReview: () => void;
  onOrganize: (scope: 'canvas' | 'all') => void;
};

export function Banners({ state, sheetOpen, organizing, onReview, onOrganize }: Props) {
  const meta = useApp((s) => s.meta);
  const [hideRecovery, setHideRecovery] = useState(false);
  const [hideIntro, setHideIntro] = useState(false);
  const batch = meta.suggestions;
  const tabSug = meta.tabSuggestion;

  const banners: React.ReactNode[] = [];

  if (meta.recovery && !hideRecovery && meta.recovery.problems.length > 0) {
    banners.push(
      <div key="recovery" className="banner glass" role="status">
        <div className="banner-row">
          <LifeBuoy size={16} className="banner-icon" />
          <div className="banner-text">
            <div className="banner-title">
              {meta.recovery.source === 'backup' ? 'Workspace restored from a local backup' : 'Started a fresh workspace'}
            </div>
            <div className="banner-sub">The latest saved state could not be read. Older backups are under Settings → Backup.</div>
            <div className="banner-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHideRecovery(true)}>
                OK
              </button>
            </div>
          </div>
        </div>
      </div>,
    );
  }

  if (tabSug) {
    banners.push(
      <div key="tabsug" className="banner glass" role="status">
        <div className="banner-row">
          <ArrowRightLeft size={16} className="banner-icon" />
          <div className="banner-text">
            <div className="banner-title">Move to “{tabSug.canvasName}”?</div>
            <div className="banner-sub">
              {tabSug.tabTitle.slice(0, 70)}
              {tabSug.reason ? ` · ${tabSug.reason}` : ''}
            </div>
            <div className="banner-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void run({ type: 'ACCEPT_TAB_SUGGESTION' })}>
                Move
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run({ type: 'DISMISS_TAB_SUGGESTION' })}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>,
    );
  }

  if (batch && batch.suggestions.length > 0 && !sheetOpen) {
    const first = batch.suggestions[0];
    const single = batch.suggestions.length === 1;
    const total = batch.suggestions.reduce((n, s) => n + s.tabIds.length, 0);
    banners.push(
      <div key="batch" className="banner glass" role="status">
        <div className="banner-row">
          <Sparkles size={16} className="banner-icon" />
          <div className="banner-text">
            <div className="banner-title">
              {single
                ? `${first.tabIds.length} tabs look related. ${first.existingCanvasId ? 'Move to' : 'Create'} “${first.name}”?`
                : `${total} tabs fit ${batch.suggestions.length} canvases.`}
            </div>
            <div className="banner-sub">{batch.providerLabel}</div>
            <div className="banner-actions">
              {single && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() =>
                    void run({
                      type: 'APPLY_SUGGESTIONS',
                      suggestions: [{ name: first.name, description: first.description, tabIds: first.tabIds, existingCanvasId: first.existingCanvasId }],
                    })
                  }
                >
                  {first.existingCanvasId ? 'Move' : 'Create'}
                </button>
              )}
              <button type="button" className={`btn btn-sm ${single ? 'btn-secondary' : 'btn-primary'}`} onClick={onReview}>
                Review
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run({ type: 'DISMISS_SUGGESTIONS' })}>
                Ignore
              </button>
            </div>
          </div>
        </div>
      </div>,
    );
  }

  const intro = state.canvases.length === 1 && state.tabs.length >= 6 && !batch && !hideIntro;
  if (intro) {
    banners.push(
      <div key="intro" className="banner glass">
        <div className="banner-row">
          <Sparkles size={16} className="banner-icon" />
          <div className="banner-text">
            <div className="banner-title">{state.tabs.length} tabs in one place</div>
            <div className="banner-sub">Let Chromotion suggest focused canvases. Nothing moves until you confirm.</div>
            <div className="banner-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={organizing} onClick={() => onOrganize('all')}>
                {organizing ? 'Organizing…' : 'Organize'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHideIntro(true)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>,
    );
  }

  return <>{banners}</>;
}
