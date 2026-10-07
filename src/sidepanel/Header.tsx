import {
  FolderPlus,
  Info,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Pencil,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
} from 'lucide-react';
import { useState } from 'react';
import { AccentDot } from '../components/AccentDot';
import { ColorSwatches } from '../components/ColorSwatches';
import { InlineRename } from '../components/InlineRename';
import { Menu } from '../components/Menu';
import { run, toast, undo, useApp } from '../hooks/useAppState';
import type { Canvas, StoredTab } from '../types';

type Props = {
  canvas: Canvas;
  tabs: StoredTab[];
  dark: boolean;
  organizing: boolean;
  onOrganize: (scope: 'canvas' | 'all') => void;
  onNewCanvas: () => void;
};

export function Header({ canvas, tabs, dark, organizing, onOrganize, onNewCanvas }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [naming, setNaming] = useState(false);
  const undoInfo = useApp((s) => s.meta.undo);
  const open = tabs.filter((t) => t.chromeTabId !== undefined).length;
  const stored = tabs.length - open;

  const suggestName = async () => {
    setNaming(true);
    const res = await run({ type: 'SUGGEST_NAME', canvasId: canvas.id });
    setNaming(false);
    if (res) toast(`Named by ${res.providerLabel}`);
  };

  return (
    <header className="header glass">
      <div className="header-main">
        {renaming ? (
          <InlineRename
            initial={canvas.name}
            label="Canvas name"
            onCommit={(name) => {
              setRenaming(false);
              void run({ type: 'RENAME_CANVAS', canvasId: canvas.id, name });
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <button type="button" className="canvas-title" onClick={() => setRenaming(true)} title="Rename canvas (F2)">
            <AccentDot accent={canvas.accent} dark={dark} />
            <span className="name">{canvas.name}</span>
          </button>
        )}
        <div className="header-sub">
          {tabs.length === 0 ? 'No tabs' : `${open} open${stored ? ` · ${stored} sleeping` : ''}`}
          {canvas.description ? ` · ${canvas.description}` : ''}
        </div>
      </div>

      <button
        type="button"
        className="icon-btn brand"
        aria-label="Organize with AI"
        title="Organize with AI"
        disabled={organizing}
        onClick={() => onOrganize('canvas')}
      >
        {organizing ? <Loader2 size={17} className="spin" /> : <Sparkles size={17} />}
      </button>

      <Menu
        label="Canvas actions"
        trigger={(p) => (
          <button type="button" className="icon-btn" aria-label="Canvas actions" {...p}>
            <MoreHorizontal size={18} />
          </button>
        )}
        items={() => [
          { label: 'Rename', icon: <Pencil size={15} />, kbd: 'F2', onSelect: () => setRenaming(true) },
          {
            label: naming ? 'Naming…' : 'Suggest name with AI',
            icon: <Wand2 size={15} />,
            disabled: naming || tabs.length === 0,
            onSelect: suggestName,
          },
          { kind: 'heading', label: 'Color' },
          {
            kind: 'custom',
            render: (close) => (
              <ColorSwatches
                value={canvas.accent}
                dark={dark}
                onPick={(accent) => {
                  close();
                  void run({ type: 'UPDATE_CANVAS', canvasId: canvas.id, patch: { accent } });
                }}
              />
            ),
          },
          { kind: 'separator' },
          { label: 'Organize this canvas', icon: <Sparkles size={15} />, onSelect: () => onOrganize('canvas') },
          { label: 'Organize all tabs', icon: <LayoutGrid size={15} />, onSelect: () => onOrganize('all') },
          { label: 'New canvas', icon: <FolderPlus size={15} />, onSelect: onNewCanvas },
          { kind: 'separator' },
          {
            label: undoInfo ? `Undo ${undoInfo.label}` : 'Undo',
            icon: <Undo2 size={15} />,
            kbd: 'Ctrl Z',
            disabled: !undoInfo,
            onSelect: undo,
          },
          { label: 'Settings', icon: <Settings size={15} />, onSelect: () => chrome.runtime.openOptionsPage() },
          {
            label: 'About Chromotion',
            icon: <Info size={15} />,
            onSelect: () => void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#about') }),
          },
          { kind: 'separator' },
          {
            label: 'Delete canvas',
            icon: <Trash2 size={15} />,
            danger: true,
            onSelect: () => void run({ type: 'DELETE_CANVAS', canvasId: canvas.id }),
          },
        ]}
      />
    </header>
  );
}
