import { uploadDocument } from '@/lib/server/entities/entity-documents';
import { uploadKycDocument } from '@/lib/server/entities/kyc';
import { createCustomValue } from '@/lib/server/entities/custom-values';
import { isKycKind, type CreationEntityType, type DocumentDraft } from './types';

export type CustomFieldEntry = { formFieldId: string; value: unknown };

export type PostCreateInput = {
  entityType: CreationEntityType;
  entityId: string;
  /** Document drafts collected in the wizard (prior records + contract). */
  documents: readonly DocumentDraft[];
  /** Custom-field values keyed by form_fields.id. */
  customValues?: readonly CustomFieldEntry[];
};

export type PostCreateResult = {
  uploaded: number;
  customSaved: number;
  /** Human-readable failures — surfaced as a non-blocking warning. */
  failures: string[];
};

const CONTRACT_KINDS = new Set(['contract', 'msa', 'sow', 'nda', 'offer_letter']);

function describe(draft: DocumentDraft): string | null {
  const bits: string[] = [];
  if (draft.docDate) bits.push(`Dated ${draft.docDate}`);
  if (draft.amount.trim()) bits.push(`Amount ${draft.amount.trim()}`);
  return bits.length ? bits.join(' · ') : null;
}

/**
 * Runs all the "extras" a creation wizard collected, AFTER the principal row
 * exists. Each item is independent and best-effort: one failed upload does not
 * roll back the entity or block the others. Returns a tally + a list of
 * human-readable failures for a non-blocking toast.
 *
 * Documents need the entity id (the upload key is `entityType/entityId/...`),
 * which is exactly why this can only run post-create.
 */
export async function runPostCreate(input: PostCreateInput): Promise<PostCreateResult> {
  const failures: string[] = [];
  let uploaded = 0;
  let customSaved = 0;

  for (const draft of input.documents) {
    if (!draft.file) continue;
    try {
      const fd = new FormData();
      fd.set('file', draft.file);
      fd.set('entityType', input.entityType);
      fd.set('entityId', input.entityId);
      fd.set('kind', draft.kind);
      if (draft.title.trim()) fd.set('title', draft.title.trim());
      const desc = describe(draft);
      if (desc) fd.set('description', desc);
      if (CONTRACT_KINDS.has(draft.kind) && draft.docDate) {
        fd.set('signedAt', draft.docDate);
      }
      if (isKycKind(draft.kind)) {
        await uploadKycDocument(fd);
      } else {
        await uploadDocument(fd);
      }
      uploaded += 1;
    } catch (e) {
      const name = draft.file?.name ?? draft.kind;
      failures.push(`${name}: ${e instanceof Error ? e.message : 'upload failed'}`);
    }
  }

  for (const entry of input.customValues ?? []) {
    if (entry.value === undefined || entry.value === null || entry.value === '') continue;
    try {
      await createCustomValue({
        entityType: input.entityType,
        entityId: input.entityId,
        formFieldId: entry.formFieldId,
        value: entry.value,
      });
      customSaved += 1;
    } catch (e) {
      failures.push(`Custom field: ${e instanceof Error ? e.message : 'save failed'}`);
    }
  }

  return { uploaded, customSaved, failures };
}
