'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { ProfileTabs, type ProfileTab } from '@/components/entity/profile-tabs';

export type UrlTab = ProfileTab;

type UrlTabsProps = {
  tabs: readonly UrlTab[];
  defaultTab: string;
  /** Query-param key used to track the active tab. Default `tab`. */
  paramKey?: string;
  /** Content keyed by tab value. Missing keys render `null`. */
  children: Record<string, React.ReactNode>;
  className?: string;
  listClassName?: string;
};

/**
 * Dashboard-side URL-bound wrapper around the canonical `<ProfileTabs>` in
 * `components/entity/`. Binds the active tab to a `nuqs` query param so
 * refreshing the page restores the view (CLAUDE rule 13).
 *
 * OS does not use this wrapper — it consumes `<ProfileTabs>` directly with
 * window-store-backed tab state.
 */
export function UrlTabs({
  tabs,
  defaultTab,
  paramKey = 'tab',
  children,
  className,
  listClassName,
}: UrlTabsProps) {
  const [raw, setRaw] = useQueryState(paramKey, parseAsString.withDefault(defaultTab));
  const valid = tabs.some((t) => t.value === raw);
  const activeTab = valid ? raw : defaultTab;

  return (
    <ProfileTabs
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(next) => {
        void setRaw(next === defaultTab ? null : next);
      }}
      className={className}
      listClassName={listClassName}
    >
      {children}
    </ProfileTabs>
  );
}
