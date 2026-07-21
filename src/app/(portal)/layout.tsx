/**
 * Employee portal route group.
 *
 * Deliberately bare: the authenticated chrome (nav, sign-out, greeting) lives
 * in `me/layout.tsx` so that `/sign-in` — which must render to a signed-OUT
 * visitor — is not behind the session guard.
 *
 * On the portal hostname, `proxy.ts` rewrites `/` to `/me`. The `/me` prefix is
 * kept visible rather than stripped: every nav href and redirect in here is
 * `/me/...`-prefixed, and rewriting to clean URLs would double-prefix them.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-background min-h-screen w-full">{children}</div>;
}
