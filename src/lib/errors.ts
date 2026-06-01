/**
 * Typed application errors. Server actions throw or return these; UI maps
 * the `kind` to a friendly message + status code. No raw `Error` objects
 * escape the service layer.
 */
export type AppErrorKind =
  // Generic
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'unauthenticated'
  | 'forbidden'
  | 'rate_limited'
  | 'internal'
  // Ledger-specific
  | 'ledger.unbalanced'
  | 'ledger.posted_immutable'
  | 'ledger.delete_forbidden'
  | 'ledger.attribution_missing'
  | 'ledger.control_violation'
  | 'ledger.external_ref_clash'
  | 'ledger.period_closed'
  | 'ledger.source_document_missing'
  // KYC / vault
  | 'kyc.reveal_capability'
  | 'kyc.audit_log_required'
  // Storage / upload
  | 'storage.mime_mismatch'
  | 'storage.size_exceeded'
  // Form Builder
  | 'form.field_key_immutable'
  | 'form.field_type_immutable'
  | 'form.required_backfill_needed'
  // Contract gating
  | 'contract.required_for_create';

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly detail?: unknown;
  readonly httpStatus: number;

  constructor(
    kind: AppErrorKind,
    message: string,
    options?: { detail?: unknown; cause?: unknown; httpStatus?: number },
  ) {
    super(message, { cause: options?.cause });
    this.kind = kind;
    this.detail = options?.detail;
    this.httpStatus = options?.httpStatus ?? defaultStatus(kind);
    this.name = 'AppError';
  }
}

function defaultStatus(kind: AppErrorKind): number {
  switch (kind) {
    case 'validation':
    case 'ledger.unbalanced':
    case 'ledger.attribution_missing':
    case 'ledger.control_violation':
    case 'ledger.source_document_missing':
    case 'storage.mime_mismatch':
    case 'storage.size_exceeded':
    case 'form.field_key_immutable':
    case 'form.field_type_immutable':
    case 'form.required_backfill_needed':
    case 'contract.required_for_create':
      return 400;
    case 'unauthenticated':
      return 401;
    case 'forbidden':
    case 'kyc.reveal_capability':
    case 'ledger.posted_immutable':
    case 'ledger.delete_forbidden':
    case 'ledger.period_closed':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
    case 'ledger.external_ref_clash':
      return 409;
    case 'rate_limited':
      return 429;
    case 'internal':
    case 'kyc.audit_log_required':
      return 500;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
