-- Billing Phase 1.3 — reference-data seeds:
--   - tds_reference_sections  (warning-only TDS thresholds + default rates)
--   - service_items           (Apār's starter SAC catalog)
--
-- CLAUDE rule #2 (THE rule): we do NOT auto-compute TDS or GST. These
-- rows feed the validation engine's "captured value differs from
-- reference" warnings and the invoice-composer's quick-pick UI. The
-- accountant always types the actual amount.
--
-- All rates are in basis points (1% = 100, 10% = 1000); all thresholds
-- and rates in paise where applicable.
--
-- Idempotent via ON CONFLICT on the unique indexes.

-- ============================================================================
-- 1. TDS reference sections — effective from FY 2025-26 (2025-04-01).
--    Sources: Income Tax Act ss. 192-194Q; Finance Act 2024 amendments.
-- ============================================================================

INSERT INTO tds_reference_sections (
  section_code, description,
  default_rate_bps_individual, default_rate_bps_company,
  threshold_single_paise, threshold_fy_paise,
  effective_from_date, effective_to_date,
  payer_type_modifier_notes
) VALUES
  (
    '192',
    'Salary',
    NULL, NULL,                       -- variable per slab; no default
    NULL, NULL,                       -- no flat threshold
    DATE '2025-04-01', NULL,
    'Computed per employee slab (CLAUDE rule #2: never auto-compute). Use payroll module output, not this row, as authoritative.'
  ),
  (
    '194C',
    'Payments to contractors / sub-contractors',
    100, 200,                         -- 1% individual / HUF; 2% company / firm
    3000000, 10000000,                -- ₹30,000 single payment; ₹1,00,000 FY aggregate
    DATE '2025-04-01', NULL,
    'No TDS if PAN missing — apply §206AA flat 20% (capture manually). Higher rates under §206AB if vendor is non-filer of last 2 returns.'
  ),
  (
    '194J',
    'Professional / technical services, royalty, FTS',
    1000, 1000,                       -- 10% flat
    NULL, 5000000,                    -- ₹50,000 FY aggregate (rate reverted to 10% from 2025-04-01)
    DATE '2025-04-01', NULL,
    'Rate had been cut to 2% in earlier amendment; reinstated to 10% from 2025-04-01. Higher rates apply for §206AA / §206AB defaulters.'
  ),
  (
    '194I-b',
    'Rent of building / land / furniture',
    1000, 1000,                       -- 10%
    NULL, 24000000,                   -- ₹2,40,000 FY aggregate
    DATE '2025-04-01', NULL,
    'For rent of plant & machinery, use 194I-p (2%) instead.'
  ),
  (
    '194I-p',
    'Rent of plant / equipment / machinery',
    200, 200,                         -- 2%
    NULL, 24000000,                   -- ₹2,40,000 FY aggregate
    DATE '2025-04-01', NULL,
    NULL
  ),
  (
    '194H',
    'Commission / brokerage',
    500, 500,                         -- 5%
    NULL, 1500000,                    -- ₹15,000 FY aggregate
    DATE '2025-04-01', NULL,
    NULL
  ),
  (
    '194Q',
    'Purchase of goods (turnover > ₹10 Cr buyer)',
    10, 10,                           -- 0.1%
    NULL, 5000000,                    -- ₹50,00,000 FY aggregate (only after threshold)
    DATE '2025-04-01', NULL,
    'Applies only if buyer turnover in prior FY > ₹10 Cr. Apār does not currently exceed this threshold; row seeded for future reference.'
  )
ON CONFLICT (section_code, effective_from_date) DO NOTHING;
--> statement-breakpoint

-- ============================================================================
-- 2. service_items — Apār's starter SAC catalog.
--    Six common SACs covering advertising, design, and consulting services.
--    Default GST rate = 18% (1800 bps). Default income account = 4100
--    Service Revenue.
-- ============================================================================

INSERT INTO service_items (
  sac_code, name, description,
  default_rate_paise, default_unit,
  default_income_account_id,
  default_gst_rate_bps, default_tds_section,
  is_active
)
SELECT
  v.sac_code, v.name, v.description,
  v.default_rate_paise, v.default_unit,
  (SELECT id FROM accounts WHERE code = '4100' LIMIT 1) AS default_income_account_id,
  v.default_gst_rate_bps, v.default_tds_section,
  true
FROM (VALUES
  (
    '998361', 'Advertising Services',
    'Conceptualisation, creative, copy, media planning, campaign execution.',
    NULL::bigint, NULL::text, 1800, '194C'
  ),
  (
    '998363', 'Advertising Space (Print / Outdoor)',
    'Buying / reselling advertising space in newspapers, magazines, hoardings, transit, cinema.',
    NULL::bigint, NULL::text, 1800, '194C'
  ),
  (
    '998391', 'Specialty Design Services',
    'Branding, identity, graphic design, packaging, environmental design.',
    NULL::bigint, NULL::text, 1800, '194J'
  ),
  (
    '998311', 'Management Consulting Services',
    'Strategy, market research, brand strategy, organisational consulting.',
    NULL::bigint, 'hour'::text, 1800, '194J'
  ),
  (
    '998313', 'IT Consulting & Support Services',
    'Digital / website / tech-stack consulting; not classified as advertising.',
    NULL::bigint, 'hour'::text, 1800, '194J'
  ),
  (
    '998399', 'Other Professional, Technical & Business Services',
    'Catch-all for retainers, fractional services, advisory engagements that do not fit other SACs.',
    NULL::bigint, NULL::text, 1800, '194J'
  )
) AS v (sac_code, name, description, default_rate_paise, default_unit, default_gst_rate_bps, default_tds_section)
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
