'use client';

import { useEffect, useState } from 'react';
import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, AlertTriangleIcon } from 'lucide-react';
import { toast } from 'sonner';

import {
  getDraftTransactionFlags,
  postTransactionAction,
} from '@/lib/server/entities/transaction-actions';
import type { ValidationFlag } from '@/lib/server/ledger/types';

export type PostTransactionDialogProps = {
  transactionId: string | null;
  /** Display label shown in the dialog header (reference / external ref). */
  label: string;
  onOpenChange: (open: boolean) => void;
  /** Called after the orchestrator returns successfully. */
  onPosted: () => void;
};

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; flags: readonly ValidationFlag[]; status: string }
  | { kind: 'error'; message: string };

const SEVERITY_ICON: Record<string, typeof InfoIcon> = {
  info: InfoIcon,
  warn: AlertTriangleIcon,
  block: AlertCircleIcon,
};

export function PostTransactionDialog({
  transactionId,
  label,
  onOpenChange,
  onPosted,
}: PostTransactionDialogProps) {
  const open = transactionId !== null;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !transactionId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setState({ kind: 'loading' });
      setAcked(new Set());
    });
    getDraftTransactionFlags(transactionId)
      .then((res) => {
        if (!cancelled) setState({ kind: 'ready', flags: res.flags, status: res.status });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Could not load transaction',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, transactionId]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onOpenChange]);

  function toggleAck(code: string) {
    setAcked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const blockFlags =
    state.kind === 'ready' ? state.flags.filter((f) => f.severity === 'block') : [];
  const allBlocksAcked = blockFlags.every((f) => acked.has(f.code));

  async function submit() {
    if (!transactionId) return;
    setSubmitting(true);
    try {
      await postTransactionAction({
        transactionId,
        acknowledgedFlags: Array.from(acked),
      });
      toast.success('Transaction posted.');
      onPosted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not post transaction');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="os-modal-overlay"
      onMouseDown={() => {
        if (!submitting) onOpenChange(false);
      }}
    >
      <div className="os-modal" style={{ width: 560 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head">
          <div className="font-display" style={{ fontSize: 18 }}>
            Post transaction?
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflowY: 'auto',
          }}
        >
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            {label ? (
              <span className="font-mono" style={{ color: 'var(--text)' }}>
                {label}
              </span>
            ) : (
              'Draft → Posted'
            )}
            {state.kind === 'ready' && state.status !== 'draft' ? (
              <span style={{ marginLeft: 6, color: 'var(--text-error, #c33)' }}>
                (already {state.status})
              </span>
            ) : null}
          </p>

          {state.kind === 'loading' ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Loading flags…</p>
          ) : state.kind === 'error' ? (
            <p style={{ fontSize: 13, color: 'var(--text-error, #c33)', margin: 0 }}>
              {state.message}
            </p>
          ) : state.flags.length === 0 ? (
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-muted)',
                margin: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <CheckCircle2Icon
                style={{ width: 16, height: 16, color: 'var(--apar-green, #2E8F5A)' }}
                aria-hidden
              />
              No validation flags. Safe to post.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>
                {state.flags.length} validation flag{state.flags.length === 1 ? '' : 's'} —
                acknowledge block-severity ones to continue.
              </p>
              <ul
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                }}
              >
                {state.flags.map((f) => {
                  const Icon = SEVERITY_ICON[f.severity] ?? InfoIcon;
                  const tone =
                    f.severity === 'block'
                      ? 'var(--text-error, #c33)'
                      : f.severity === 'warn'
                        ? 'var(--apar-amber, #d08a1e)'
                        : 'var(--text-muted)';
                  return (
                    <li
                      key={f.code}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}
                    >
                      <input
                        type="checkbox"
                        checked={acked.has(f.code)}
                        onChange={() => toggleAck(f.code)}
                        disabled={submitting}
                        style={{ marginTop: 3, cursor: 'pointer' }}
                        aria-label={`Acknowledge ${f.code}`}
                      />
                      <Icon
                        style={{ width: 16, height: 16, flexShrink: 0, color: tone, marginTop: 2 }}
                        aria-hidden
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: tone,
                          }}
                        >
                          {f.severity}
                        </div>
                        <div style={{ fontSize: 12.5 }}>
                          <code style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)' }}>
                            {f.code}
                          </code>
                          {' — '}
                          {f.message}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '12px 16px 14px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            className="btn"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={(e) => {
              e.preventDefault();
              void submit();
            }}
            disabled={
              submitting || state.kind !== 'ready' || state.status !== 'draft' || !allBlocksAcked
            }
          >
            {submitting
              ? 'Posting…'
              : blockFlags.length > 0 && !allBlocksAcked
                ? `Acknowledge ${blockFlags.length} block flag(s)`
                : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}
