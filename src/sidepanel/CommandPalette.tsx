import {
  ArrowLeft,
  ArrowRightLeft,
  FolderPlus,
  History,
  LayoutGrid,
  Search,
  Settings,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AccentDot } from '../components/AccentDot';
import { Favicon } from '../components/Favicon';
import { search } from '../features/search/search';
import { run, switchCanvas, undo, useApp } from '../hooks/useAppState';
import { fuzzyScore } from '../lib/text';
import { displayUrl } from '../lib/url';
import type { PersistedState } from '../types';

type Item = {
  id: string;
  group: 'Actions' | 'Canvases' | 'Tabs' | 'Move current tab to';
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void | Promise<unknown>;
  keepOpen?: boolean;
};

type Props = {
  state: PersistedState;
  dark: boolean;
  onClose: () => void;
  onOrganize: (scope: 'canvas' | 'all') => void;
};

const openOptions = (hash = '') => {
  if (!hash) return chrome.runtime.openOptionsPage();
  void chrome.tabs.create({ url: chrome.runtime.getURL(`options/index.html#${hash}`) });
};

export function CommandPalette({ state, dark, onClose, onOrganize }: Props) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'root' | 'move'>('root');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const undoInfo = useApp((s) => s.meta.undo);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of state.tabs) m.set(t.canvasId, (m.get(t.canvasId) ?? 0) + 1);
    return m;
  }, [state.tabs]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const items = useMemo<Item[]>(() => {
    const canvasName = (id: string) => state.canvases.find((c) => c.id === id)?.name ?? '';
    if (mode === 'move') {
      return state.canvases
        .filter((c) => !c.archived && c.id !== state.lastActiveCanvasId)
        .map((c) => ({ c, score: fuzzyScore(query, c.name) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ c }) => ({
          id: `move-${c.id}`,
          group: 'Move current tab to' as const,
          label: c.name,
          hint: `${counts.get(c.id) ?? 0} tabs`,
          icon: <AccentDot accent={c.accent} dark={dark} />,
          run: () => run({ type: 'MOVE_CURRENT_TAB', canvasId: c.id }),
        }));
    }

    const q = query.trim();
    const actions: Item[] = [
      {
        id: 'create',
        group: 'Actions',
        label: q ? `Create canvas “${q}”` : 'Create canvas',
        icon: <FolderPlus size={16} />,
        run: () => run({ type: 'CREATE_CANVAS', name: q || undefined, switchTo: true }),
      },
      {
        id: 'move',
        group: 'Actions',
        label: 'Move current tab…',
        icon: <ArrowRightLeft size={16} />,
        keepOpen: true,
        run: () => {
          setMode('move');
          setQuery('');
          setIndex(0);
        },
      },
      { id: 'organize', group: 'Actions', label: 'Organize with AI', hint: 'this canvas', icon: <Sparkles size={16} />, run: () => onOrganize('canvas') },
      { id: 'organize-all', group: 'Actions', label: 'Organize all tabs with AI', icon: <LayoutGrid size={16} />, run: () => onOrganize('all') },
      { id: 'restore', group: 'Actions', label: 'Restore workspace…', hint: 'backups', icon: <History size={16} />, run: () => openOptions('backup') },
      { id: 'settings', group: 'Actions', label: 'Open settings', icon: <Settings size={16} />, run: () => openOptions() },
      ...(undoInfo
        ? [{ id: 'undo', group: 'Actions' as const, label: `Undo ${undoInfo.label}`, icon: <Undo2 size={16} />, run: undo }]
        : []),
    ];
    const filteredActions = q
      ? actions.filter((a) => a.id === 'create' || fuzzyScore(q, a.label) > 0).sort((a, b) => (a.id === 'create' ? 1 : 0) - (b.id === 'create' ? 1 : 0))
      : actions;

    const res = search(state, q);
    const canvases: Item[] = res.canvases.slice(0, 8).map(({ canvas }) => ({
      id: `canvas-${canvas.id}`,
      group: 'Canvases',
      label: canvas.name,
      hint: canvas.id === state.lastActiveCanvasId ? 'current' : `${counts.get(canvas.id) ?? 0} tabs`,
      icon: <AccentDot accent={canvas.accent} dark={dark} />,
      run: () => switchCanvas(canvas.id),
    }));
    const tabs: Item[] = res.tabs.map(({ tab }) => ({
      id: `tab-${tab.id}`,
      group: 'Tabs',
      label: tab.title || tab.url,
      hint: `${canvasName(tab.canvasId)} · ${displayUrl(tab.url)}`,
      icon: <Favicon url={tab.url} />,
      run: () => run({ type: 'OPEN_TAB', tabId: tab.id }),
    }));
    const exact = res.canvases.some((r) => r.canvas.name.toLowerCase() === q.toLowerCase());
    const acts = exact ? filteredActions.filter((a) => a.id !== 'create') : filteredActions;
    // With a query, matches first and actions after; empty query: actions first.
    return q ? [...canvases, ...tabs, ...acts] : [...acts, ...canvases, ...tabs];
  }, [state, query, mode, dark, counts, undoInfo, onOrganize]);

  useEffect(() => setIndex(0), [query, mode]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    if (!item.keepOpen) onClose();
    void item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setIndex(items.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'move') setMode('root');
      else onClose();
    } else if (e.key === 'Backspace' && mode === 'move' && query === '') {
      setMode('root');
    } else if (e.key === 'Tab') {
      e.preventDefault(); // focus stays in the palette
    }
  };

  let lastGroup = '';
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="palette-input">
          {mode === 'move' ? (
            <button type="button" className="icon-btn sm" aria-label="Back" onClick={() => setMode('root')}>
              <ArrowLeft size={16} />
            </button>
          ) : (
            <Search size={17} />
          )}
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'move' ? 'Move current tab to…' : 'Search tabs, canvases and actions'}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[index] ? `pi-${items[index].id}` : undefined}
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <div ref={listRef} id="palette-list" className="palette-results scroll" role="listbox" aria-label="Results">
          {items.length === 0 && <div className="empty">No matches. Press Enter on “Create canvas” to make one.</div>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? <div className="palette-group" role="presentation">{item.group}</div> : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header}
                <div
                  id={`pi-${item.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  className="palette-item"
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => choose(item)}
                >
                  {item.icon}
                  <span className="label">{item.label}</span>
                  {item.hint && <span className="hint">{item.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> {mode === 'move' ? 'back' : 'close'}
          </span>
        </div>
      </div>
    </>,
    document.body,
  );
}
