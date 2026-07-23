'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Icon } from '../icons';
import { signInEmployee } from '@/lib/server/employee-auth';
import { useLockClock } from './use-lock-clock';

/**
 * Employee sign-in, styled as a lock-screen (matching the admin one). Unlike
 * the admin screen it shows NO roster of accounts — an employee types their
 * username (or work email), so the staff list is never enumerable pre-auth.
 *
 * On success the employee session cookie is set server-side and we hand off to
 * the restricted employee workspace at /employee.
 */
export function EmployeeSignIn({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const { time, date } = useLockClock();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await signInEmployee(username, password);
      if (r.ok) {
        router.replace('/employee');
      } else {
        setError(r.error);
        setPassword('');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="lock-screen">
      <div aria-hidden className="lock-screen__noise" />

      <button type="button" className="lock-screen__back" onClick={onBack}>
        <Icon name="arrowRight" size={13} stroke={2.4} /> Back
      </button>

      <div className="lock-screen__clock" suppressHydrationWarning>
        <div className="lock-screen__date">{date}</div>
        <div className="lock-screen__time">{time}</div>
      </div>

      {/* spacer where the admin roster sits, so the stack lands at the same height */}
      <div aria-hidden />

      <form className="lock-screen__stack" onSubmit={submit}>
        <div className="lock-screen__avatar is-mark" aria-hidden>
          <img src="/brand/apar-orange-square.png" alt="" draggable={false} />
        </div>
        <div className="lock-screen__greeting">Employee sign-in</div>
        <div className="lock-screen__hint">Use your username or work email</div>

        <div className="lock-screen__field">
          <input
            autoFocus
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            disabled={pending}
            aria-label="Username or work email"
          />
        </div>

        <div className={`lock-screen__field ${error ? 'has-error' : ''}`}>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Password"
            autoComplete="current-password"
            disabled={pending}
            aria-label="Password"
          />
          <button
            type="submit"
            className="lock-screen__submit"
            disabled={pending || !password || !username}
            aria-label="Sign in"
          >
            <Icon name="arrowRight" size={14} stroke={2.4} />
          </button>
        </div>

        {error ? (
          <div className="lock-screen__error" role="alert">
            {error}
          </div>
        ) : (
          <div className="lock-screen__caps">
            <span>Forgot your password? Ask your admin to reset it.</span>
          </div>
        )}
      </form>

      <div className="lock-screen__footer">Apar One · Employee workspace</div>
    </div>
  );
}
