'use client';

import { toast as sonnerToast } from 'sonner';

/**
 * Thin wrapper over sonner so the import surface stays small. Forms call
 * `notify.success(message)` / `notify.error(message)` / `notify.info(message)`.
 *
 * Keeping the wrapper means: if the team ever decides to swap toast libraries,
 * it's one file. It also makes mocking trivial in unit tests.
 */
export const notify = {
  success: (message: string, description?: string) => sonnerToast.success(message, { description }),
  error: (message: string, description?: string) => sonnerToast.error(message, { description }),
  info: (message: string, description?: string) => sonnerToast(message, { description }),
};
