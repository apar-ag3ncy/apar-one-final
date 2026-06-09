-- 0038_invoice_theme_capability — seed role_capabilities for the new
-- `manage_invoice_themes` capability added to lib/rbac.ts CAPABILITIES.
--
-- Distribution (mirrors lib/rbac.ts DEFAULT_GRANTS):
--   partner    — always (requireCapability short-circuits; seeded for clarity)
--   admin      — granted (manages the global theme list + .docx uploads)
--   accountant — granted (same billing tier as create/send invoice)
--   manager    — not granted (composes invoices, but theme catalog is admin-tier)
--   employee   — never
--   viewer     — never
--
-- Capability code MUST match the CAPABILITIES tuple in lib/rbac.ts —
-- loadCapabilities() filters out unknown codes. Idempotent via
-- ON CONFLICT (role, capability) DO NOTHING.

DO $$
DECLARE
  cap text := 'manage_invoice_themes';
BEGIN
  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('partner', cap, true)
  ON CONFLICT (role, capability) DO NOTHING;

  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('admin', cap, true)
  ON CONFLICT (role, capability) DO NOTHING;

  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('accountant', cap, true)
  ON CONFLICT (role, capability) DO NOTHING;

  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('manager', cap, false)
  ON CONFLICT (role, capability) DO NOTHING;

  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('employee', cap, false)
  ON CONFLICT (role, capability) DO NOTHING;

  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('viewer', cap, false)
  ON CONFLICT (role, capability) DO NOTHING;
END $$;
--> statement-breakpoint
