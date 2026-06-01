// The OS demo owns the whole viewport. We deliberately don't wrap children
// in any chrome here — the inner `OsRoot` provides its own menubar, dock,
// and windowing system.
//
// Future server-side auth gate (SPEC-AMENDMENT-001 §8.2 + FRONTEND-OS-AUDIT
// P0-2 / P2-6): when Supabase Auth ships, this becomes an async component
// that calls `currentUser()` and redirects in two cases:
//   - no user                                          → /(auth)/login
//   - user.role is in PORTAL_ONLY_ROLES (employee)     → /me
// Until then, `OsRoot` performs the second redirect client-side via
// `useRouter().replace('/me')` once it detects a portal-only role string.

export default function OsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
