import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type MenuEntry =
  | { kind?: 'item'; label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; kbd?: string }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }
  | { kind: 'custom'; render: (close: () => void) => ReactNode };

type Props = {
  trigger: (props: { ref: (el: HTMLButtonElement | null) => void; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: MenuEntry[] | (() => MenuEntry[]);
  align?: 'start' | 'end';
  label: string;
};

/** Small accessible popover menu: Esc / outside click close, arrow keys move. */
export function Menu({ trigger, items, align = 'end', label }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !btn.current || !menu.current) return;
    const r = btn.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    let left = align === 'end' ? r.right - m.width : r.left;
    left = Math.max(6, Math.min(left, window.innerWidth - m.width - 6));
    let top = r.bottom + 4;
    if (top + m.height > window.innerHeight - 6) top = Math.max(6, r.top - m.height - 4);
    setPos({ top, left });
    menu.current.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]')?.focus();
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const list = open ? (typeof items === 'function' ? items() : items) : [];

  return (
    <>
      {trigger({
        ref: (el) => (btn.current = el),
        onClick: () => setOpen((o) => !o),
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open &&
        createPortal(
          <div ref={menu} className="menu scroll" role="menu" aria-label={label} style={pos} onKeyDown={onKeyDown}>
            {list.map((entry, i) => {
              if (entry.kind === 'separator') return <div key={i} className="menu-sep" role="separator" />;
              if (entry.kind === 'heading') return <div key={i} className="menu-heading">{entry.label}</div>;
              if (entry.kind === 'custom') return <div key={i}>{entry.render(close)}</div>;
              return (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  className={`menu-item${entry.danger ? ' danger' : ''}`}
                  disabled={entry.disabled}
                  onClick={() => {
                    close();
                    entry.onSelect();
                  }}
                >
                  {entry.icon}
                  <span>{entry.label}</span>
                  {entry.kbd && <span className="kbd">{entry.kbd}</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
