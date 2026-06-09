'use client';

// Cash Flow — native OS window. There is no getCashFlowStatement backend yet,
// so this renders an honest "not available" state (no fabricated numbers)
// and points the user at the live Office Ledger, which shows real cash + bank
// movements with a running balance today.

import { osActions } from '@/lib/os/store';
import { ReportWindowFrame } from './report-window-kit';

export function CashFlowWindow() {
  return (
    <ReportWindowFrame
      title="Cash Flow"
      subtitle="Operating / investing / financing cash movements."
    >
      <div
        style={{
          border: '1px dashed var(--border)',
          borderRadius: 8,
          padding: 20,
          color: 'var(--text-muted)',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Cash flow statement isn’t available yet
        </div>
        It activates once the cash-flow backend ships. In the meantime, the{' '}
        <button
          type="button"
          className="btn"
          style={{ padding: '2px 8px' }}
          onClick={() =>
            osActions.openWindow({
              app: 'ledger',
              entityId: 'office',
              title: 'Office ledger',
              position: 'beside-focused',
            })
          }
        >
          Office Ledger
        </button>{' '}
        shows live cash + bank movements with a running balance and is fully exportable.
      </div>
    </ReportWindowFrame>
  );
}
