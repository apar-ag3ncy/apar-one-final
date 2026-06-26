'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { initials } from '../format';
import { useAuth } from './store';
import type { User } from './types';

/**
 * Apple-style lock screen. Full-bleed wallpaper, clock at the top, row of user
 * avatars centred above the active avatar / name / password field stack.
 *
 * The first time the demo loads only the super admin exists, so the screen
 * just shows that one avatar pre-selected.
 */
export function LockScreen() {
  const { allUsers, signIn } = useAuth();

  // Default selection: super admin if no other choice, otherwise the most recently created user.
  const [selectedId, setSelectedId] = useState<string>(() => {
    const last = allUsers[allUsers.length - 1];
    return last?.id ?? 'super-admin';
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // See menubar.tsx — `now` stays null on the server + first paint so
  // hydration matches; the effect sets it on mount.
  const [now, setNow] = useState<Date | null>(null);

  const selected: User = useMemo(
    () => allUsers.find((u) => u.id === selectedId) ?? allUsers[0]!,
    [allUsers, selectedId],
  );

  // Live clock. The first set is deferred to the next frame (not a
  // synchronous setState in the effect body) so `now` stays null for the
  // hydration paint, avoiding an SSR/CSR mismatch.
  useEffect(() => {
    const update = () => setNow(new Date());
    const raf = requestAnimationFrame(update);
    const t = setInterval(update, 1000 * 15);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);

  const time = now
    ? now.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '';
  const date = now
    ? now.toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : '';

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    // Tiny intentional delay so the button shows a transition state — purely cosmetic.
    setTimeout(() => {
      const ok = signIn(selected.username, password);
      if (!ok) {
        setError('Incorrect password.');
        setPassword('');
      }
      setPending(false);
    }, 220);
  };

  return (
    <div className="lock-screen">
      <div aria-hidden className="lock-screen__noise" />

      <div className="lock-screen__clock" suppressHydrationWarning>
        <div className="lock-screen__date">{date}</div>
        <div className="lock-screen__time">{time}</div>
      </div>

      {/* User selector row — visible only when more than one user exists. */}
      {allUsers.length > 1 && (
        <div className="lock-screen__user-row" role="radiogroup" aria-label="Choose a user">
          {allUsers.map((u) => (
            <button
              key={u.id}
              type="button"
              role="radio"
              aria-checked={u.id === selectedId}
              className={`lock-screen__user ${u.id === selectedId ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(u.id)}
              title={u.fullName}
            >
              {u.role === 'super_admin' || u.role === 'admin' ? (
                <span className="lock-screen__user-avatar is-mark" aria-hidden>
                  <img src="/brand/apar-orange-square.png" alt="" draggable={false} />
                </span>
              ) : (
                <span
                  className="lock-screen__user-avatar"
                  style={{ background: u.tone }}
                  aria-hidden
                >
                  {initials(u.fullName)}
                </span>
              )}
              <span className="lock-screen__user-name">{u.fullName.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      )}

      {/* key on the form forces a remount when the user changes — password / error
          / pending state reset naturally without a setState-in-effect dance. */}
      <form key={selected.id} className="lock-screen__stack" onSubmit={submit}>
        {selected.role === 'super_admin' || selected.role === 'admin' ? (
          <div className="lock-screen__avatar is-mark" aria-hidden>
            <img src="/brand/apar-orange-square.png" alt="" draggable={false} />
          </div>
        ) : (
          <div className="lock-screen__avatar" style={{ background: selected.tone }} aria-hidden>
            {initials(selected.fullName)}
          </div>
        )}
        <div className="lock-screen__greeting">{selected.fullName}</div>
        <div className="lock-screen__hint">@{selected.username}</div>

        <div className={`lock-screen__field ${error ? 'has-error' : ''}`}>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Enter Password"
            autoComplete="current-password"
            disabled={pending}
            aria-label={`Password for ${selected.fullName}`}
          />
          <button
            type="submit"
            className="lock-screen__submit"
            disabled={pending || !password}
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
            {selected.role === 'super_admin' ? (
              <span>
                Demo default password: <span className="font-mono">apar2026</span>
              </span>
            ) : (
              <span>Forgot your password? Ask the operator to reset it.</span>
            )}
          </div>
        )}
      </form>

      <div className="lock-screen__footer">Apar One · Demo build · Not for production sign-in</div>
    </div>
  );
}
