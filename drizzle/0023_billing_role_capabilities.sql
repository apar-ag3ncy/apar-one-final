-- Billing Phase 1.5 — seed role_capabilities for the 12 new billing
-- capabilities added to lib/rbac.ts CAPABILITIES tuple.
--
-- Distribution (mirrors lib/rbac.ts DEFAULT_GRANTS):
--
--   partner     — every capability (lib/rbac.ts short-circuits;
--                 seeded for Studio UI clarity)
--   admin       — every billing capability
--   accountant  — all except manage_billing_settings and
--                 manage_tax_reference_sections (those are admin-tier)
--   manager     — create_invoice, send_invoice, manage_estimate
--                 (compose for their clients; cannot void / credit-note
--                  / touch payments)
--   employee    — none
--   viewer      — none
--
-- Capability codes here MUST match the CAPABILITIES tuple in
-- lib/rbac.ts. loadCapabilities() filters out any code not in
-- CAPABILITY_SET, so a stray row here would be silently ignored
-- — but the schema-level UNIQUE on (role, capability) keeps the table
-- clean.
--
-- Idempotent: ON CONFLICT (role, capability) DO NOTHING per existing
-- pattern in 0006_phase3_seeds_and_triggers.sql:152.

DO $$
DECLARE
  billing_caps text[] := ARRAY[
    'create_invoice',
    'send_invoice',
    'void_invoice',
    'manage_credit_note',
    'manage_estimate',
    'receive_payment',
    'manage_recurring',
    'manage_billing_settings',
    'manage_service_items',
    'manage_party_billing_profile',
    'view_gst_reports',
    'manage_tax_reference_sections'
  ];
  accountant_billing_caps text[] := ARRAY[
    'create_invoice',
    'send_invoice',
    'void_invoice',
    'manage_credit_note',
    'manage_estimate',
    'receive_payment',
    'manage_recurring',
    'manage_service_items',
    'manage_party_billing_profile',
    'view_gst_reports'
    -- excludes manage_billing_settings, manage_tax_reference_sections
  ];
  manager_billing_caps text[] := ARRAY[
    'create_invoice',
    'send_invoice',
    'manage_estimate'
  ];
  cap text;
BEGIN
  FOREACH cap IN ARRAY billing_caps LOOP
    -- partner: always
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('partner', cap, true)
    ON CONFLICT (role, capability) DO NOTHING;

    -- admin: all billing caps
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('admin', cap, true)
    ON CONFLICT (role, capability) DO NOTHING;

    -- accountant: most, excluding settings + tax-section editing
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('accountant', cap, cap = ANY(accountant_billing_caps))
    ON CONFLICT (role, capability) DO NOTHING;

    -- manager: just the compose-and-send subset
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('manager', cap, cap = ANY(manager_billing_caps))
    ON CONFLICT (role, capability) DO NOTHING;

    -- employee: never
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('employee', cap, false)
    ON CONFLICT (role, capability) DO NOTHING;

    -- viewer: never
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('viewer', cap, false)
    ON CONFLICT (role, capability) DO NOTHING;
  END LOOP;
END $$;
--> statement-breakpoint
