'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SearchIcon } from 'lucide-react';
import { CommandPalette, type SearchResult } from '@/components/entity/command-palette';
import { useEntityNavigate } from '@/lib/client/use-navigate';
import { searchEntities } from '@/lib/server-stub/entity-actions';

/**
 * Dashboard-side host for the shared `<CommandPalette>`. Owns the open state,
 * binds Cmd+K (Ctrl+K), and dispatches search through the stub adapter
 * (`searchEntities`). When Backend ships /api/search the adapter changes;
 * this host doesn't.
 */
export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  const onNavigate = useEntityNavigate();

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isCmdK) {
        event.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const handleSearch = useCallback(async (query: string): Promise<readonly SearchResult[]> => {
    const rows = await searchEntities(query);
    return rows.map(
      (r): SearchResult => ({
        type: r.type,
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
      }),
    );
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hidden gap-2 md:inline-flex"
        aria-label="Open command palette"
      >
        <SearchIcon className="size-3.5" aria-hidden />
        Search…
        <kbd className="bg-muted text-muted-foreground ml-2 rounded border px-1.5 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="md:hidden"
        aria-label="Open command palette"
      >
        <SearchIcon className="size-4" aria-hidden />
      </Button>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        onSearch={handleSearch}
        onNavigate={onNavigate}
      />
    </>
  );
}
