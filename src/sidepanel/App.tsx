import { FolderInput, FolderPlus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accentColor } from '../components/AccentDot';
import { Backdrop, HelpScreen } from '../components/Brand';
import { Menu } from '../components/Menu';
import { Toasts } from '../components/Toasts';
import { countsByCanvas, sortedCanvases, tabsOf } from '../features/canvases/selectors';
import { run, switchCanvas, toast, undo, useApp } from '../hooks/useAppState';
import { useIsDark, useTheme } from '../hooks/useTheme';
import { Banners } from './Banners';
import { CanvasList } from './CanvasList';
import { CommandPalette } from './CommandPalette';
import { Header } from './Header';
import { OrganizeSheet } from './OrganizeSheet';
import { TabList } from './TabList';

const isMac = navigator.platform.toLowerCase().includes('mac');
const MOD = isMac ? '⌘' : 'Ctrl';

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

export function App() {
  const state = useApp((s) => s.state);
  const pendingCanvasId = useApp((s) => s.pendingCanvasId);
  const undoInfo = useApp((s) => s.meta.undo);
  const batch = useApp((s) => s.meta.suggestions);
  useTheme(state?.preferences.theme);
  const dark = useIsDark();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string>();
  // Watchdog: if the background never answers, explain instead of spinning forever.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (state) return setStalled(false);
    const t = setTimeout(() => setStalled(true), 6000);
    return () => clearTimeout(t);
  }, [state]);

  const canvases = useMemo(() => sortedCanvases(state), [state]);
  const counts = useMemo(() => countsByCanvas(state), [state]);
  const activeId = pendingCanvasId ?? state?.lastActiveCanvasId ?? canvases[0]?.id;
  const canvas = canvases.find((c) => c.id === activeId) ?? canvases[0];
  const tabs = useMemo(() => tabsOf(state, canvas?.id), [state, canvas?.id]);

  useEffect(() => setSelected(new Set()), [canvas?.id]);

  // One Undo toast per new undoable action, wherever it came from.
  const lastUndoAt = useRef<number | undefined>(undefined);
  const primed = useRef(false);
  useEffect(() => {
    if (!state) return;
    if (!primed.current) {
      primed.current = true;
      lastUndoAt.current = undoInfo?.at;
      return;
    }
    if (undoInfo && undoInfo.at !== lastUndoAt.current && Date.now() - undoInfo.at < 4000) {
      toast(undoInfo.label, { action: { label: 'Undo', run: undo } });
    }
    lastUndoAt.current = undoInfo?.at;
  }, [undoInfo, state]);

  const organize = useCallback(
    async (scope: 'canvas' | 'all', canvasId?: string) => {
      if (organizing) return;
      setOrganizing(true);
      const res = await run({ type: 'ORGANIZE', scope, canvasId: canvasId ?? canvas?.id });
      setOrganizing(false);
      if (!res) return;
      if (res.suggestions.length === 0) toast('Nothing to regroup — these tabs already look tidy.');
      else setSheetOpen(true);
    },
    [organizing, canvas?.id],
  );

  const newCanvas = useCallback(async () => {
    const res = await run({ type: 'CREATE_CANVAS' });
    if (res) setRenamingId(res.canvasId);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && !isTyping(e.target)) {
        e.preventDefault();
        void undo();
      } else if (e.altKey && /^[1-9]$/.test(e.key) && !isTyping(e.target)) {
        const target = canvases[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          void switchCanvas(target.id);
        }
      } else if (e.key === 'F2' && !isTyping(e.target) && canvas && !(e.target as HTMLElement)?.closest?.('.canvas-item')) {
        e.preventDefault();
        setRenamingId(canvas.id);
      } else if (e.key === '/' && !isTyping(e.target)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canvases, canvas]);

  if (!state || !canvas) {
    if (stalled) return <HelpScreen reason="no-response" />;
    return (
      <div className="app">
        <Backdrop />
        <div className="empty glass" style={{ flex: 1, borderRadius: 18 }}>
          Loading your canvases…
        </div>
      </div>
    );
  }

  const selectedIds = [...selected].filter((id) => tabs.some((t) => t.id === id));

  return (
    <div className="app" style={{ '--canvas-accent': accentColor(canvas.accent, dark) } as React.CSSProperties}>
      <Backdrop />
      <Header
        canvas={canvas}
        tabs={tabs}
        dark={dark}
        organizing={organizing}
        onOrganize={(scope) => void organize(scope)}
        onNewCanvas={() => void newCanvas()}
      />

      <button type="button" className="search-trigger glass" onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Control+K Meta+K">
        <Search size={15} />
        <span>Search or jump to…</span>
        <kbd>{MOD} K</kbd>
      </button>

      <Banners state={state} sheetOpen={sheetOpen} organizing={organizing} onReview={() => setSheetOpen(true)} onOrganize={(s) => void organize(s)} />

      {selectedIds.length > 0 && (
        <div className="selection-bar" role="toolbar" aria-label="Selection actions">
          <span className="count">{selectedIds.length} selected</span>
          <Menu
            label="Move selection"
            align="end"
            trigger={(p) => (
              <button type="button" className="btn btn-sm" {...p}>
                <FolderInput size={14} /> Move
              </button>
            )}
            items={() => [
              ...canvases
                .filter((c) => c.id !== canvas.id)
                .map((c) => ({
                  label: c.name,
                  onSelect: () => {
                    setSelected(new Set());
                    void run({ type: 'MOVE_TABS', tabIds: selectedIds, canvasId: c.id });
                  },
                })),
              { kind: 'separator' as const },
              {
                label: 'New canvas from selection',
                icon: <FolderPlus size={15} />,
                onSelect: () => {
                  setSelected(new Set());
                  void run({ type: 'CREATE_CANVAS', tabIds: selectedIds });
                },
              },
            ]}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setSelected(new Set());
              void run({ type: 'CLOSE_TABS', tabIds: selectedIds });
            }}
          >
            Close
          </button>
          <button type="button" className="btn btn-sm" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X size={14} />
          </button>
        </div>
      )}

      <TabList canvas={canvas} tabs={tabs} canvases={canvases} dark={dark} selected={selected} setSelected={setSelected} />

      <CanvasList
        canvases={canvases}
        counts={counts}
        activeId={canvas.id}
        dark={dark}
        renamingId={renamingId}
        setRenamingId={setRenamingId}
        onCreate={() => void newCanvas()}
        onOrganize={(id) => void organize('canvas', id)}
      />

      {paletteOpen && <CommandPalette state={state} dark={dark} onClose={() => setPaletteOpen(false)} onOrganize={(s) => void organize(s)} />}
      {sheetOpen && batch && batch.suggestions.length > 0 && (
        <OrganizeSheet key={batch.id} batch={batch} state={state} onClose={() => setSheetOpen(false)} />
      )}
      <Toasts />
    </div>
  );
}
