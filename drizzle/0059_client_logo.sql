-- 0059_client_logo — client brand logos.
--
-- logo_document_id points at a documents row (uploaded through the standard
-- entity-documents pipeline, kind 'photo'). The OS renders the logo instead
-- of name initials wherever the client avatar appears. Deleting the document
-- nulls the pointer — the avatar falls back to initials.

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "logo_document_id" uuid REFERENCES "documents"(id) ON DELETE SET NULL;
--> statement-breakpoint
