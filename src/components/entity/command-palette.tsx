'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BuildingIcon,
  FileTextIcon,
  FolderKanbanIcon,
  ReceiptIcon,
  SearchIcon,
  StoreIcon,
  UserIcon,
} from 'lucide-react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import type { EntityType, NavigationTarget } from './types';

export type SearchResult = {
  type: EntityType;
  id: string;
  /** Headline (e.g. "Marigold Coffee Roasters"). */
  title: string;
  /** Secondary text (e.g. "Mumbai · F&B"). */
  subtitle?: string | null;
};

export type CommandPaletteProps = {
  /**
   * Open/close. The host typically binds Cmd+K (or `/`) globally to
   * toggle this — keeping it controlled lets OS share the same component
   * with its own keybindings.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Async search callback. The implementation typically debounces and calls
   * `/api/search` on the server. The palette ignores stale promises (only
   * the most recent query's result is rendered).
   */
  onSearch: (query: string) => Promise<readonly SearchResult[]>;
  /** Click → navigate. */
  onNavigate: (target: NavigationTarget) => void;
  /** Optional quick actions rendered at the top of the empty palette. */
  quickActions?: readonly QuickAction[];
};

export type QuickAction = {
  id: string;
  label: string;
  hint?: string;
  onSelect: () => void;
};

const ICONS: Record<EntityType, typeof UserIcon> = {
  client: BuildingIcon,
  vendor: StoreIcon,
  employee: UserIcon,
  project: FolderKanbanIcon,
  transaction: ReceiptIcon,
  document: FileTextIcon,
};

const GROUP_LABELS: Record<EntityType, string> = {
  client: 'Clients',
  vendor: 'Vendors',
  employee: 'Employees',
  project: 'Projects',
  transaction: 'Transactions',
  document: 'Documents',
};

/**
 * Cmd+K command palette built on cmdk via the shadcn wrapper.
 *
 * Surface-agnostic: no `next/navigation`, no Supabase. The host wires the
 * keybinding and the `onSearch` server call. Dashboard wires `useEntityNavigate`
 * to `onNavigate`; OS wires `openWindow`.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onSearch,
  onNavigate,
  quickActions,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      // TODO(human): refactor to derived state with a key reset on open prop;
      // suppressing the cascading-render lint for now because the parent
      // controls `open` and the reset cost is small.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setPending(true);
    const handle = setTimeout(() => {
      void onSearch(query)
        .then((next) => {
          if (!cancelled) setResults(next);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setPending(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, onSearch]);

  const grouped = useMemo(() => groupByType(results), [results]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="max-w-xl">
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search clients, vendors, employees, projects, transactions…"
        />
        <CommandList>
          {pending ? (
            <CommandEmpty>Searching…</CommandEmpty>
          ) : query.trim().length === 0 ? (
            quickActions && quickActions.length > 0 ? (
              <CommandGroup heading="Quick actions">
                {quickActions.map((action) => (
                  <CommandItem
                    key={action.id}
                    onSelect={() => {
                      action.onSelect();
                      onOpenChange(false);
                    }}
                  >
                    <SearchIcon className="mr-2 size-3.5 opacity-60" aria-hidden />
                    {action.label}
                    {action.hint ? (
                      <span className="text-muted-foreground ml-auto text-xs">{action.hint}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandEmpty>
                Start typing to search across clients, vendors, employees, and projects.
              </CommandEmpty>
            )
          ) : results.length === 0 ? (
            <CommandEmpty>No matches.</CommandEmpty>
          ) : (
            grouped.map((group, idx) => {
              const Icon = ICONS[group.type];
              return (
                <div key={group.type}>
                  {idx > 0 ? <CommandSeparator /> : null}
                  <CommandGroup heading={GROUP_LABELS[group.type]}>
                    {group.results.map((r) => (
                      <CommandItem
                        key={`${r.type}-${r.id}`}
                        value={`${r.type}-${r.id}-${r.title}`}
                        onSelect={() => {
                          onNavigate({ type: r.type, id: r.id });
                          onOpenChange(false);
                        }}
                      >
                        <Icon className="mr-2 size-3.5 opacity-60" aria-hidden />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{r.title}</span>
                          {r.subtitle ? (
                            <span className="text-muted-foreground truncate text-xs">
                              {r.subtitle}
                            </span>
                          ) : null}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </div>
              );
            })
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function groupByType(results: readonly SearchResult[]) {
  const order: readonly EntityType[] = [
    'client',
    'vendor',
    'employee',
    'project',
    'transaction',
    'document',
  ];
  const map = new Map<EntityType, SearchResult[]>();
  for (const r of results) {
    if (!map.has(r.type)) map.set(r.type, []);
    map.get(r.type)!.push(r);
  }
  return order.filter((type) => map.has(type)).map((type) => ({ type, results: map.get(type)! }));
}
