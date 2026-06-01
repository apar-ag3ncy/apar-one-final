/**
 * Shared types for the `components/entity/*` family.
 *
 * These components are consumed by BOTH the Dashboard routes and the OS windows
 * (Session C). They must therefore be navigation-surface-agnostic: never import
 * from `next/navigation`, never construct URLs internally, never call Supabase
 * directly. All navigation flows through the `onNavigate` callback prop.
 */

export type EntityType = 'client' | 'vendor' | 'employee' | 'project' | 'transaction' | 'document';

/**
 * Surface-agnostic navigation target.
 *
 * Dashboard wraps with `onNavigate={(t) => router.push(targetToUrl(t))}`.
 * OS wraps with `onNavigate={(t) => openWindow(t)}`.
 */
export type NavigationTarget = {
  type: EntityType;
  id: string;
  /** Optional sub-tab key (e.g. 'transactions', 'documents'). */
  tab?: string;
};

/** Discriminated "back" prop used by ProfileHeader. */
export type BackTarget = { href: string; label: string } | { onClick: () => void; label: string };

/** Common entity status. Tone mapping lives in the rendering layer. */
export type EntityStatus =
  | 'active'
  | 'onboarding'
  | 'inactive'
  | 'archived'
  | 'draft'
  | 'posted'
  | 'reversed'
  | 'pending';

/**
 * Field-level confidence from the extraction pipeline (CLAUDE rule 8).
 * Rendered as a small badge next to extracted fields on the review screen.
 */
export type FieldConfidence = 'high' | 'medium' | 'low' | 'missing';

/**
 * Reveal capability: returned by server actions that gate KYC / bank reveal.
 * Components render the "Reveal" button only when canReveal is true; clicking
 * invokes the provided onReveal callback which opens a 60s signed URL.
 */
export type RevealCallback = (id: string) => Promise<{ url: string; expiresAt: string }>;
