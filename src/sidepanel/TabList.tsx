import { useVirtualizer } from '@tanstack/react-virtual';
import { FolderInput, FolderPlus, Moon, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AccentDot } from '../components/AccentDot';
import { Favicon } from '../components/Favicon';
import { Menu, type MenuEntry } from '../components/Menu';
import { run } from '../hooks/useAppState';
import { displayUrl } from '../lib/url';
import type { Canvas, StoredTab } from '../types';
import { MIME_TABS } from './dnd';

type Props = {
  canvas: Canvas;
  tabs: StoredTab[];
  canvases: Canvas[];
  dark: boolean;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
};

const ROW = 46;

export function TabList({ canvas, tabs, canvases, dark, selected, setSelected }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [draggingIds, setDraggingIds] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);

  const virtualizer = useVirtualizer({
    count: tabs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 10,
    getItemKey: (i) => tabs[i]?.id ?? i,
  });

  useEffect(() => {
    setFocusIndex((i) => Math.min(i, Math.max(0, tabs.length - 1)));
  }, [tabs.length]);

  const focusRow = useCallback(
    (i: number) => {
      const idx = Math.max(0, Math.min(i, tabs.length - 1));
      setFocusIndex(idx);
      virtualizer.scrollToIndex(idx, { align: 'auto' });
      requestAnimationFrame(() => document.getElementById(`tab-${tabs[idx]?.id}`)?.focus());
    },
    [tabs, virtualizer],
  );

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const idsFor = useCallback((tabId: string) => {
    const sel = selectedRef.current;
    return sel.has(tabId) ? [...sel] : [tabId];
  }, []);

  const onRowClick = useCallback(
    (e: React.MouseEvent, index: number) => {
      const tab = tabsRef.current[index];
      setFocusIndex(index);
      if (e.metaKey || e.ctrlKey) {
        const next = new Set(selectedRef.current);
        if (next.has(tab.id)) next.delete(tab.id);
        else next.add(tab.id);
        anchor.current = index;
        setSelected(next);
        return;
      }
      if (e.shiftKey) {
        const from = anchor.current ?? index;
        const [a, b] = from < index ? [from, index] : [index, from];
        setSelected(new Set(tabsRef.current.slice(a, b + 1).map((t) => t.id)));
        return;
      }
      anchor.current = index;
      if (selectedRef.current.size) setSelected(new Set());
      void run({ type: 'OPEN_TAB', tabId: tab.id });
    },
    [setSelected],
  );

  const onDragStart = useCallback((e: React.DragEvent, tab: StoredTab) => {
    const ids = idsFor(tab.id);
    e.dataTransfer.setData(MIME_TABS, JSON.stringify(ids));
    e.dataTransfer.setData('text/uri-list', tab.url);
    e.dataTransfer.setData('text/plain', tab.url);
    e.dataTransfer.effectAllowed = 'copyMove';
    setDraggingIds(new Set(ids));
  }, [idsFor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (tabs.length === 0) return;
    const tab = tabs[focusIndex];
    const extend = (to: number) => {
      const idx = Math.max(0, Math.min(to, tabs.length - 1));
      const next = new Set(selected);
      next.add(tab.id);
      next.add(tabs[idx].id);
      setSelected(next);
      focusRow(idx);
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.shiftKey ? extend(focusIndex + 1) : focusRow(focusIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.shiftKey ? extend(focusIndex - 1) : focusRow(focusIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusRow(0);
        break;
      case 'End':
        e.preventDefault();
        focusRow(tabs.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        void run({ type: 'OPEN_TAB', tabId: tab.id });
        break;
      case ' ': {
        e.preventDefault();
        const next = new Set(selected);
        if (next.has(tab.id)) next.delete(tab.id);
        else next.add(tab.id);
        setSelected(next);
        break;
      }
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        void run({ type: 'CLOSE_TABS', tabIds: idsFor(tab.id) });
        break;
      case 'a':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setSelected(new Set(tabs.map((t) => t.id)));
        }
        break;
      case 'Escape':
        if (selected.size) {
          e.preventDefault();
          e.stopPropagation();
          setSelected(new Set());
        }
        break;
    }
  };

  if (tabs.length === 0) {
    return (
      <div className="tab-list glass empty">
        <strong>This canvas is empty</strong>
        <span>Open a new tab while it is active, or drag tabs onto it below.</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="tab-list glass scroll"
      role="listbox"
      aria-label={`Tabs in ${canvas.name}`}
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const tab = tabs[item.index];
          return (
            <TabRow
              key={tab.id}
              tab={tab}
              index={item.index}
              top={item.start}
              focused={item.index === focusIndex}
              selected={selected.has(tab.id)}
              dragging={draggingIds.has(tab.id)}
              canvases={canvases}
              currentCanvasId={canvas.id}
              dark={dark}
              idsFor={idsFor}
              onClick={onRowClick}
              onDragStart={onDragStart}
              onDragEnd={() => setDraggingIds(new Set())}
              clearSelection={() => setSelected(new Set())}
            />
          );
        })}
      </div>
    </div>
  );
}

type RowProps = {
  tab: StoredTab;
  index: number;
  top: number;
  focused: boolean;
  selected: boolean;
  dragging: boolean;
  canvases: Canvas[];
  currentCanvasId: string;
  dark: boolean;
  idsFor: (id: string) => string[];
  onClick: (e: React.MouseEvent, index: number) => void;
  onDragStart: (e: React.DragEvent, tab: StoredTab) => void;
  onDragEnd: () => void;
  clearSelection: () => void;
};

const TabRow = memo(function TabRow(p: RowProps) {
  const { tab } = p;
  const isOpen = tab.chromeTabId !== undefined;
  const moveItems = (): MenuEntry[] => {
    const ids = p.idsFor(tab.id);
    const others = p.canvases.filter((c) => c.id !== p.currentCanvasId);
    return [
      { kind: 'heading', label: ids.length > 1 ? `Move ${ids.length} tabs to` : 'Move to' },
      ...others.map((c) => ({
        label: c.name,
        icon: <AccentDot accent={c.accent} dark={p.dark} />,
        onSelect: () => {
          p.clearSelection();
          void run({ type: 'MOVE_TABS', tabIds: ids, canvasId: c.id });
        },
      })),
      ...(others.length ? [{ kind: 'separator' as const }] : []),
      {
        label: 'New canvas…',
        icon: <FolderPlus size={15} />,
        onSelect: () => {
          p.clearSelection();
          void run({ type: 'CREATE_CANVAS', tabIds: ids });
        },
      },
    ];
  };

  return (
    <div
      id={`tab-${tab.id}`}
      role="option"
      aria-selected={p.selected}
      tabIndex={p.focused ? 0 : -1}
      className={`tab-row${tab.active && isOpen ? ' active' : ''}${isOpen ? '' : ' stored'}${p.selected ? ' selected' : ''}${p.dragging ? ' dragging' : ''}`}
      style={{ transform: `translateY(${p.top}px)` }}
      draggable
      onDragStart={(e) => p.onDragStart(e, tab)}
      onDragEnd={p.onDragEnd}
      onClick={(e) => p.onClick(e, p.index)}
      title={`${tab.title}\n${tab.url}${isOpen ? '' : '\n(sleeping — opens on click)'}`}
    >
      <Favicon url={tab.url} />
      <div className="tab-text">
        <div className="tab-title">{tab.title || tab.url}</div>
        <div className="tab-url">
          {!isOpen && <Moon size={11} aria-label="Sleeping" />}
          <span>{displayUrl(tab.url)}</span>
        </div>
      </div>
      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
        <Menu
          label="Move tab"
          items={moveItems}
          trigger={(t) => (
            <button type="button" className="icon-btn sm" aria-label="Move to canvas" title="Move to canvas" tabIndex={-1} {...t}>
              <FolderInput size={15} />
            </button>
          )}
        />
        <button
          type="button"
          className="icon-btn sm"
          aria-label="Close tab"
          title="Close tab (Del)"
          tabIndex={-1}
          onClick={() => void run({ type: 'CLOSE_TABS', tabIds: p.idsFor(tab.id) })}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
});
