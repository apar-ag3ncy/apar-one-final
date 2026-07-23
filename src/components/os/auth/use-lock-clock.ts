'use client';

import { useEffect, useState } from 'react';

/**
 * Shared lock-screen clock. `now` stays null on the server + first paint so
 * hydration matches; the effect sets it on mount (deferred to the next frame),
 * then ticks every 15s. Mirrors the pattern in lock-screen.tsx / menubar.tsx.
 */
export function useLockClock(): { time: string; date: string } {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    const raf = requestAnimationFrame(update);
    const t = setInterval(update, 1000 * 15);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);

  return {
    time: now
      ? now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
      : '',
    date: now
      ? now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
      : '',
  };
}
