'use client';

import { useState } from 'react';

import { Icon, type IconName } from '../icons';
import { LockScreen } from './lock-screen';
import { EmployeeSignIn } from './employee-sign-in';
import { useLockClock } from './use-lock-clock';

/**
 * The single sign-in entry at /os. First it asks WHICH kind of account is
 * signing in, then routes to that account's credential screen:
 *
 *   - Admin / Operator → the OS lock screen (os_users roster + password).
 *   - Employee         → a lock-screen-styled username/password (no roster).
 *
 * ACCOUNT_TYPES is a plain list so more kinds (e.g. client / vendor portals)
 * can be added later by appending an entry + a branch in the switch.
 */

type AccountTypeKey = 'admin' | 'employee';

type AccountType = {
  key: AccountTypeKey;
  label: string;
  desc: string;
  icon: IconName;
};

const ACCOUNT_TYPES: readonly AccountType[] = [
  {
    key: 'admin',
    label: 'Admin / Operator',
    desc: 'The full workspace — accounts, ledgers, projects, team and settings.',
    icon: 'settings',
  },
  {
    key: 'employee',
    label: 'Employee',
    desc: 'Your own space — tasks, team directory, attendance and leaves.',
    icon: 'users',
  },
  // Future account types append here (e.g. client / vendor portal).
];

export function AccountGate() {
  const [picked, setPicked] = useState<AccountTypeKey | null>(null);

  if (picked === 'admin') {
    return (
      <>
        <LockScreen />
        <button
          type="button"
          className="lock-screen__back"
          onClick={() => setPicked(null)}
          style={{ zIndex: 11 }}
        >
          <Icon name="arrowRight" size={13} stroke={2.4} /> Back
        </button>
      </>
    );
  }

  if (picked === 'employee') {
    return <EmployeeSignIn onBack={() => setPicked(null)} />;
  }

  return <AccountTypePicker onPick={setPicked} />;
}

function AccountTypePicker({ onPick }: { onPick: (k: AccountTypeKey) => void }) {
  const { time, date } = useLockClock();

  return (
    <div className="lock-screen">
      <div aria-hidden className="lock-screen__noise" />

      <div className="lock-screen__clock" suppressHydrationWarning>
        <div className="lock-screen__date">{date}</div>
        <div className="lock-screen__time">{time}</div>
      </div>

      <div className="lock-screen__pick">
        <div className="lock-screen__pick-title">Who&rsquo;s signing in?</div>
        <div className="lock-screen__types" role="list">
          {ACCOUNT_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="listitem"
              className="lock-screen__type-card"
              onClick={() => onPick(t.key)}
            >
              <span className="lock-screen__type-icon" aria-hidden>
                <Icon name={t.icon} size={26} />
              </span>
              <span className="lock-screen__type-label">{t.label}</span>
              <span className="lock-screen__type-desc">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="lock-screen__footer">Apar One · Choose your account to continue</div>
    </div>
  );
}
