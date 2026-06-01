import { AppError } from './errors';

/**
 * Discriminated-union Result type used at the server-action / service
 * boundary. Inside services we still throw `AppError` for control flow,
 * but the outermost server-action handler funnels everything through
 * `Result<T, AppError>` so the Frontend never sees a thrown error and
 * gets a typed shape it can pattern-match on.
 */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Run a server-action body and convert any thrown `AppError` into the
 * `Err` branch. Unknown errors become a generic `internal` AppError so
 * stack traces never leak to the client.
 */
export async function tryResult<T>(fn: () => Promise<T>): Promise<Result<T, AppError>> {
  try {
    return Ok(await fn());
  } catch (err) {
    if (err instanceof AppError) {
      return Err(err);
    }
    // Anything else is a programmer error. Log and return an opaque error.
    // eslint-disable-next-line no-console
    console.error('[tryResult] uncaught error in server action:', err);
    return Err(new AppError('internal', 'An unexpected error occurred.', { cause: err }));
  }
}
