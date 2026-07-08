'use client';

// Shared os-modal chrome — extracted from apps.tsx so windows outside the
// dock apps (project window, form modals in ./apps/*) can reuse the same
// Modal / ConfirmDialog / Field primitives without importing the whole
// apps.tsx module graph.

import { useEffect, type ReactNode } from 'react';

import { Icon } from '../icons';

export function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="os-modal-overlay" onMouseDown={onClose}>
      <div className="os-modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head">
          <div className="font-display" style={{ fontSize: 18 }}>
            {title}
          </div>
          <button className="btn" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="os-modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Demo-grade confirmation dialog. Used in place of window.confirm so the OS
 *  keeps a cohesive look. `destructive` styles the confirm button red. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} width={420}>
      <div className="os-form">
        <div
          style={{
            padding: '4px 2px 12px',
            color: 'var(--text-muted)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn primary"
            style={
              destructive
                ? { background: 'var(--apar-red-deep)', borderColor: 'transparent' }
                : undefined
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Field({
  label,
  children,
  hint,
  full,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  full?: boolean;
}) {
  return (
    <label className="os-field" style={full ? { gridColumn: '1 / -1' } : undefined}>
      <span className="os-field-label">{label}</span>
      {children}
      {hint && <span className="os-field-hint">{hint}</span>}
    </label>
  );
}
