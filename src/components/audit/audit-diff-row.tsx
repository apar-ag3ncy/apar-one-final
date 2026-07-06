'use client';

/**
 * Renders a single audit_log `changes` jsonb as a key-by-key diff list.
 *
 * The diff shape is what `logAudit` writes: a flat map of column name →
 * `{ before, after }`. Both sides can be any JSON value; we coerce to
 * stringified form for display and fall back to `<empty>` for null /
 * undefined / empty string so the diff is unambiguous.
 */

export type ChangeDiff = Record<string, { before?: unknown; after?: unknown }>;

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v.length === 0 ? '∅' : v;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export function AuditDiffRow({ changes }: { changes: ChangeDiff }) {
  const entries = Object.entries(changes ?? {}).filter(
    ([, v]) => v && typeof v === 'object' && 'before' in (v as object) && 'after' in (v as object),
  );

  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-xs italic">
        No structured diff (likely an insert or a non-diff event).
      </p>
    );
  }

  return (
    <div className="space-y-1.5 text-xs">
      {entries.map(([col, val]) => {
        const before = fmt((val as { before?: unknown }).before);
        const after = fmt((val as { after?: unknown }).after);
        return (
          <div
            key={col}
            className="grid grid-cols-[6.5rem_1fr_1fr] gap-2 rounded border border-dashed px-2 py-1"
          >
            <span className="text-muted-foreground font-mono break-words [overflow-wrap:anywhere]">
              {col}
            </span>
            <span
              className="text-muted-foreground break-words [overflow-wrap:anywhere]"
              title={before}
            >
              <span className="mr-1 text-rose-500">−</span>
              {before}
            </span>
            <span className="break-words [overflow-wrap:anywhere]" title={after}>
              <span className="mr-1 text-emerald-500">+</span>
              {after}
            </span>
          </div>
        );
      })}
    </div>
  );
}
