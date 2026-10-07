import { MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AccentDot } from '../components/AccentDot';
import { Signature } from '../components/Brand';
import { ColorSwatches } from '../components/ColorSwatches';
import { InlineRename } from '../components/InlineRename';
import { Menu } from '../components/Menu';
import { run, switchCanvas } from '../hooks/useAppState';
import type { Canvas } from '../types';
import { hasType, MIME_CANVAS, MIME_TABS } from './dnd';

type Props = {
  canvases: Canvas[];
  counts: Map<string, number>;
  activeId: string;
  dark: boolean;
  renamingId?: string;
  setRenamingId: (id?: string) => void;
  onCreate: () => void;
  onOrganize: (canvasId: string) => void;
};

type DropState = { id: string; mode: 'into' | 'before' | 'after' } | undefined;

export function CanvasList({ canvases, counts, activeId, dark, renamingId, setRenamingId, onCreate, onOrganize }: Props) {
  const [drop, setDrop] = useState<DropState>();
  const ids = canvases.map((c) => c.id);

  const reorder = (moving: string, target: string, after: boolean) => {
    if (moving === target) return;
    const next = ids.filter((id) => id !== moving);
    const at = next.indexOf(target) + (after ? 1 : 0);
    next.splice(at, 0, moving);
    void run({ type: 'REORDER_CANVASES', orderedIds: next });
  };

  const focusItem = (i: number) => document.getElementById(`canvas-${canvases[Math.max(0, Math.min(i, canvases.length - 1))]?.id}`)?.focus();

  const onKeyDown = (e: React.KeyboardEvent, c: Canvas, i: number) => {
    if (renamingId) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey) {
      e.preventDefault();
      const j = e.key === 'ArrowDown' ? i + 1 : i - 1;
      if (j < 0 || j >= canvases.length) return;
      reorder(c.id, canvases[j].id, e.key === 'ArrowDown');
      requestAnimationFrame(() => document.getElementById(`canvas-${c.id}`)?.focus());
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(i - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void switchCanvas(c.id);
    } else if (e.key === 'F2') {
      e.preventDefault();
      setRenamingId(c.id);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void deleteCanvas(c);
    }
  };

  const deleteCanvas = (c: Canvas) => run({ type: 'DELETE_CANVAS', canvasId: c.id });

  return (
    <section className="canvases glass" aria-label="Canvases">
      <div className="section-label">
        <span id="canvases-label">Canvases</span>
        <button type="button" className="icon-btn sm" aria-label="New canvas" title="New canvas" onClick={onCreate}>
          <Plus size={16} />
        </button>
      </div>
      <ul className="canvas-list scroll" role="listbox" aria-labelledby="canvases-label">
        {canvases.map((c, i) => {
          const active = c.id === activeId;
          const dropClass = drop?.id === c.id ? (drop.mode === 'into' ? ' drop-target' : drop.mode === 'before' ? ' drop-before' : ' drop-after') : '';
          return (
            <li
              key={c.id}
              id={`canvas-${c.id}`}
              role="option"
              aria-selected={active}
              aria-label={`${c.name}, ${counts.get(c.id) ?? 0} tabs`}
              tabIndex={active ? 0 : -1}
              className={`canvas-item${active ? ' active' : ''}${dropClass}`}
              draggable={renamingId !== c.id}
              onClick={() => !active && void switchCanvas(c.id)}
              onDoubleClick={() => setRenamingId(c.id)}
              onKeyDown={(e) => onKeyDown(e, c, i)}
              onDragStart={(e) => {
                e.dataTransfer.setData(MIME_CANVAS, c.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (hasType(e, MIME_TABS)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (drop?.id !== c.id || drop.mode !== 'into') setDrop({ id: c.id, mode: 'into' });
                } else if (hasType(e, MIME_CANVAS)) {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const mode = e.clientY > r.top + r.height / 2 ? 'after' : 'before';
                  if (drop?.id !== c.id || drop.mode !== mode) setDrop({ id: c.id, mode });
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(undefined);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDrop(undefined);
                const tabIds = e.dataTransfer.getData(MIME_TABS);
                if (tabIds) {
                  void run({ type: 'MOVE_TABS', tabIds: JSON.parse(tabIds) as string[], canvasId: c.id });
                  return;
                }
                const moving = e.dataTransfer.getData(MIME_CANVAS);
                if (moving) {
                  const r = e.currentTarget.getBoundingClientRect();
                  reorder(moving, c.id, e.clientY > r.top + r.height / 2);
                }
              }}
            >
              <AccentDot accent={c.accent} dark={dark} />
              {renamingId === c.id ? (
                <InlineRename
                  initial={c.name}
                  label="Canvas name"
                  onCommit={(name) => {
                    setRenamingId(undefined);
                    void run({ type: 'RENAME_CANVAS', canvasId: c.id, name });
                  }}
                  onCancel={() => setRenamingId(undefined)}
                />
              ) : (
                <span className="name">{c.name}</span>
              )}
              <span className="count">{counts.get(c.id) ?? 0}</span>
              <span onClick={(e) => e.stopPropagation()}>
                <Menu
                  label={`${c.name} actions`}
                  trigger={(t) => (
                    <button type="button" className="icon-btn sm" aria-label={`${c.name} actions`} tabIndex={-1} {...t}>
                      <MoreHorizontal size={15} />
                    </button>
                  )}
                  items={() => [
                    { label: 'Rename', icon: <Pencil size={15} />, kbd: 'F2', onSelect: () => setRenamingId(c.id) },
                    { label: 'Organize this canvas', icon: <Sparkles size={15} />, onSelect: () => onOrganize(c.id) },
                    { kind: 'heading', label: 'Color' },
                    {
                      kind: 'custom',
                      render: (close) => (
                        <ColorSwatches
                          value={c.accent}
                          dark={dark}
                          onPick={(accent) => {
                            close();
                            void run({ type: 'UPDATE_CANVAS', canvasId: c.id, patch: { accent } });
                          }}
                        />
                      ),
                    },
                    { kind: 'separator' },
                    {
                      label: 'Delete canvas',
                      icon: <Trash2 size={15} />,
                      danger: true,
                      disabled: canvases.length <= 1,
                      onSelect: () => void deleteCanvas(c),
                    },
                  ]}
                />
              </span>
            </li>
          );
        })}
      </ul>
      <Signature />
    </section>
  );
}
