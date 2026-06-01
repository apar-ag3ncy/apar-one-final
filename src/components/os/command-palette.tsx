'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import type { CmdAction } from './types';

type Props = {
  onClose: () => void;
  actions: readonly CmdAction[];
};

// Rendered conditionally by the parent — so each open is a fresh mount and the
// q/sel state resets naturally without a setState-in-effect dance.
export function CommandPalette({ onClose, actions }: Props) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      setSel((s) => Math.min(s + 1, filtered.length - 1));
      e.preventDefault();
    }
    if (e.key === 'ArrowUp') {
      setSel((s) => Math.max(s - 1, 0));
      e.preventDefault();
    }
    if (e.key === 'Enter') {
      filtered[sel]?.run();
      onClose();
    }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="cmdk-overlay"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).classList.contains('cmdk-overlay')) onClose();
      }}
    >
      <div className="cmdk" onKeyDown={onKey}>
        <div className="cmdk-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            placeholder="Type a command, search across Apār One…"
          />
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              background: 'var(--pill-bg)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            esc
          </span>
        </div>
        <div className="cmdk-list">
          {filtered.map((a, i) => (
            <div
              key={a.label}
              className={`cmdk-row ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                a.run();
                onClose();
              }}
            >
              <Icon name={a.icon} size={15} />
              <span>{a.label}</span>
              {a.hint ? <span className="hint">{a.hint}</span> : null}
            </div>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              No results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
