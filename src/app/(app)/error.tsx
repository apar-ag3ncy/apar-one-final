'use client';

import { useEffect } from 'react';
import { AlertTriangleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AppGroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="border-border/60 bg-card/30 flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center">
      <div
        className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-full"
        aria-hidden
      >
        <AlertTriangleIcon className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Something went wrong</h2>
        <p className="text-muted-foreground max-w-md text-sm">
          The page failed to load. Try again, or contact a partner if it keeps happening.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground/70 mt-2 text-xs">Error ref: {error.digest}</p>
        ) : null}
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        Try again
      </Button>
    </div>
  );
}
