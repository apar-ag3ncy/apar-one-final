import 'server-only';

import { z } from 'zod';

/**
 * Server-only environment registry.
 *
 * Validated once at import. Throws on first read if anything required is
 * missing — fail loud at boot rather than at the first DB query. Never
 * import this from a Client Component; the `'server-only'` guard above
 * blocks bundling.
 *
 * Add new vars here AND in `.env.example` (no exceptions — `.env.example`
 * is the source of truth for what runtime needs).
 */
const EnvSchema = z.object({
  // Node / Next runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database (Postgres via Supabase)
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // App
  APP_URL: z.string().url().default('http://localhost:3000'),

  // OpenRouter / extraction LLM (Phase 3+; tolerate empty in dev)
  OPENROUTER_API_KEY: z.string().optional().default(''),
  MODEL_VENDOR_INVOICE: z.string().optional(),
  MODEL_CLIENT_INVOICE: z.string().optional(),
  MODEL_EXPENSE_RECEIPT: z.string().optional(),
  MODEL_PAYSLIP: z.string().optional(),
  MODEL_SALARY_INPUT: z.string().optional(),
  MODEL_FALLBACK: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy apar-dashboard/.env.example to .env.local and fill in the missing values.`,
    );
  }
  return parsed.data;
}

export const env: Env = loadEnv();
