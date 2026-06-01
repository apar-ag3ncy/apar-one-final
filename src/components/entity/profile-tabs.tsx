'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export type ProfileTab = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Optional badge (e.g. count) rendered after the label. */
  count?: number | string;
};

export type ProfileTabsProps = {
  tabs: readonly ProfileTab[];
  /** Currently-active tab value. Consumer owns this state. */
  activeTab: string;
  /** Called when the user clicks a different tab. */
  onTabChange: (value: string) => void;
  /** Content keyed by tab value. Missing keys render `null`. */
  children: Record<string, React.ReactNode>;
  className?: string;
  listClassName?: string;
};

/**
 * Surface-agnostic profile tabs primitive.
 *
 * Consumers own the tab-state storage:
 *   - Dashboard wraps with `useQueryState('tab', parseAsString.withDefault(...))`
 *     so refreshing the page restores the active tab (CLAUDE rule 13).
 *   - OS wraps with the window-store so each window remembers its tab.
 *
 * This component itself MUST NOT import `nuqs` or `next/navigation` — that
 * would tie the rendering surface to URL state and break OS windows.
 */
export function ProfileTabs({
  tabs,
  activeTab,
  onTabChange,
  children,
  className,
  listClassName,
}: ProfileTabsProps) {
  const isKnown = tabs.some((t) => t.value === activeTab);
  const value = isKnown ? activeTab : (tabs[0]?.value ?? '');

  return (
    <Tabs
      value={value}
      onValueChange={onTabChange}
      className={cn('flex w-full flex-col gap-4', className)}
    >
      <div className="overflow-x-auto">
        <TabsList className={cn('inline-flex', listClassName)}>
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              disabled={tab.disabled}
              className="gap-2"
            >
              <span>{tab.label}</span>
              {tab.count !== undefined ? (
                <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0 text-[10px] font-medium">
                  {tab.count}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="mt-0 outline-none">
          {children[tab.value] ?? null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
