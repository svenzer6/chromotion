import { useEffect, useRef, useState } from 'react';

type Props = {
  initial: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
};

/** Enter / blur commits, Esc cancels. */
export function InlineRename({ initial, label, onCommit, onCancel, className = '' }: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const v = value.trim();
    if (v && v !== initial) onCommit(v);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      className={`input input-inline ${className}`}
      aria-label={label}
      value={value}
      maxLength={120}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
    />
  );
}
