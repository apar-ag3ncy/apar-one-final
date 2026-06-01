-- ───────────────────────────────────────────────────────────────────────────
-- 0003_entity_subgraph — Phase 2 of the agent-backend brief.
--
-- Adds (in this order):
--   1. New enums (entity_type, contract_status, address_kind, bank_account_type,
--      tax_identifier_kind, document_kind, document_status, vendor_status,
--      employee_status, employment_type, project_status,
--      entity_relationship_kind, form_field_type, form_field_change_kind)
--   2. Principal entities (vendors, employees, projects)
--   3. Contract gating + archive columns on `clients` (ALTER)
--   4. Polymorphic children (entity_contacts, entity_addresses,
--      entity_bank_accounts, entity_tax_identifiers, entity_documents,
--      entity_relationships, entity_custom_values, entity_activity_log)
--   5. Form Builder (form_templates, form_fields, form_field_changes)
--   6. RBAC matrix (role_capabilities)
--   7. User table prefs (user_table_preferences)
--   8. Self-FKs (employees.reports_to_employee_id, entity_documents.supersedes_id)
--   9. Indexes
--
-- Polymorphic FK integrity (entity_id resolving to the right principal
-- table) is enforced by a trigger in 0004_polymorphic_check_trigger.sql.
-- RLS for these tables is enabled in 0005_phase2_rls.sql.
--
-- Brownfield discipline (per the agent-backend brief):
--   - `client_contacts` table stays in place. Server actions dual-write to
--     `entity_contacts` going forward. A compat view replacement happens
--     in a later migration after B confirms the swap.
--   - The existing `clients` columns are not touched; we only ADD COLUMN.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Enums ──────────────────────────────────────────────────────────────
CREATE TYPE "public"."entity_type" AS ENUM('client','vendor','employee','project','office');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('signed','pending','waived');--> statement-breakpoint
CREATE TYPE "public"."entity_relationship_kind" AS ENUM('introduced_by','account_manager_of','expense_on_behalf','mentor_of','reports_to','subcontractor_of');--> statement-breakpoint
CREATE TYPE "public"."vendor_status" AS ENUM('prospect','active','inactive');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('prospective','active','on_leave','notice','separated');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time','part_time','contract','intern','consultant');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('pitch','won','active','on_hold','completed','cancelled');--> statement-breakpoint
CREATE TYPE "public"."address_kind" AS ENUM('billing','shipping','registered','site','home');--> statement-breakpoint
CREATE TYPE "public"."bank_account_type" AS ENUM('current','savings','od','escrow');--> statement-breakpoint
CREATE TYPE "public"."tax_identifier_kind" AS ENUM('pan','gstin','tan','msme_udyam','lut','aadhaar');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('contract','msa','sow','nda','offer_letter','separation_letter','kyc_pan','kyc_aadhaar','kyc_passport','kyc_voter_id','kyc_driving_license','cancelled_cheque','bank_statement','invoice','receipt','payslip','salary_sheet','reimbursement_receipt','expense_receipt','photo','other');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('active','superseded','expired','soft_deleted');--> statement-breakpoint
CREATE TYPE "public"."form_field_type" AS ENUM('text','longtext','number','date','datetime','currency','select','multiselect','file','gstin','pan','phone','email','url','boolean','address','relation');--> statement-breakpoint
CREATE TYPE "public"."form_field_change_kind" AS ENUM('created','label_updated','help_text_updated','options_updated','visibility_updated','required_tightened','required_relaxed','order_updated','deprecated','restored');
--> statement-breakpoint

-- ── 2. Principal entities ─────────────────────────────────────────────────

CREATE TABLE "vendors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "name" text NOT NULL,
  "category" text,
  "status" "vendor_status" DEFAULT 'active' NOT NULL,
  "account_manager_id" uuid,
  "gstin" text,
  "pan" text,
  "msme_udyam" text,
  "contract_status" "contract_status" DEFAULT 'pending' NOT NULL,
  "contract_pending_reason" text,
  "contract_pending_until" date,
  "is_archived" boolean DEFAULT false NOT NULL,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "notes" text
);
--> statement-breakpoint

CREATE TABLE "employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "user_id" uuid,
  "employee_code" text NOT NULL,
  "full_name" text NOT NULL,
  "display_name" text,
  "work_email" text,
  "personal_email" text,
  "phone" text,
  "employment_type" "employment_type" NOT NULL,
  "status" "employee_status" DEFAULT 'active' NOT NULL,
  "designation" text,
  "department" text,
  "reports_to_employee_id" uuid,
  "joined_on" date NOT NULL,
  "confirmed_on" date,
  "separated_on" date,
  "notice_period_days" text,
  "masked_pan" text,
  "masked_aadhaar" text,
  "contract_status" "contract_status" DEFAULT 'pending' NOT NULL,
  "contract_pending_reason" text,
  "contract_pending_until" date,
  "is_archived" boolean DEFAULT false NOT NULL,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "notes" text,
  CONSTRAINT "employees_employee_code_unique" UNIQUE("employee_code"),
  CONSTRAINT "employees_work_email_unique" UNIQUE("work_email")
);
--> statement-breakpoint

CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "client_id" uuid NOT NULL,
  "lead_employee_id" uuid,
  "account_manager_id" uuid,
  "name" text NOT NULL,
  "code" text,
  "status" "project_status" DEFAULT 'pitch' NOT NULL,
  "started_on" date,
  "target_end_on" date,
  "completed_on" date,
  "notes" text,
  "is_archived" boolean DEFAULT false NOT NULL,
  "archived_at" timestamp with time zone,
  "archived_by" uuid
);
--> statement-breakpoint

-- ── 3. ALTER clients to add contract gating + archive columns ────────────

ALTER TABLE "clients" ADD COLUMN "contract_status" "contract_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "contract_pending_reason" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "contract_pending_until" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "archived_by" uuid;
--> statement-breakpoint

-- ── 4. Polymorphic children ───────────────────────────────────────────────

CREATE TABLE "entity_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "entity_type" "entity_type" NOT NULL,
  "entity_id" uuid NOT NULL,
  "name" text NOT NULL,
  "role" text,
  "email" text,
  "phone" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "notes" text,
  CONSTRAINT "entity_contacts_email_or_phone" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL)
);
--> statement-breakpoint

CREATE TABLE "entity_addresses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "entity_type" "entity_type" NOT NULL,
  "entity_id" uuid NOT NULL,
  "kind" "address_kind" NOT NULL,
  "line1" text NOT NULL,
  "line2" text,
  "city" text NOT NULL,
  "state_code" text NOT NULL,
  "postal_code" text,
  "country" text DEFAULT 'IN' NOT NULL,
  "gstin" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "notes" text
);
--> statement-breakpoint

CREATE TABLE "entity_bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "entity_type" "entity_type" NOT NULL,
  "entity_id" uuid NOT NULL,
  "holder_name" text NOT NULL,
  "account_last4" text NOT NULL,
  "ifsc" text NOT NULL,
  "bank_name" text NOT NULL,
  "branch" text,
  "account_type" "bank_account_type" NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "vault_object_key" text NOT NULL,
  "is_verified" boolean DEFAULT false NOT NULL,
  "verified_at" text,
  "verification_notes" text,
  "notes" text,
  CONSTRAINT "entity_bank_accounts_last4_format" CHECK (length("account_last4") = 4 AND "account_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint

CREATE TABLE "entity_tax_identifiers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "entity_type" "entity_type" NOT NULL,
  "entity_id" uuid NOT NULL,
  "kind" "tax_identifier_kind" NOT NULL,
  "masked_value" text NOT NULL,
  "vault_object_key" text,
  "issued_on" text,
  "expires_on" text,
  "notes" text,
  CONSTRAINT "entity_tax_identifiers_aadhaar_employee_only" CHECK (
    "kind" <> 'aadhaar' OR "entity_type" = 'employee'
  ),
  CONSTRAINT "entity_tax_identifiers_aadhaar_vault_required" CHECK (
    "kind" <> 'aadhaar' OR "vault_object_key" IS NOT NULL
  )
);
--> statement-breakpoint

CREATE TABLE "entity_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "entity_type" "entity_type" NOT NULL,
  "entity_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "kind" "document_kind" NOT NULL,
  "title" text,
  "description" text,
  "signed_by_us" boolean DEFAULT false NOT NULL,
  "signed_by_them" boolean DEFAULT false NOT NULL,
  "signed_at" date,
  "expires_at" date,
  "version" integer DEFAULT 1 NOT NULL,
  "supersedes_id" uuid,
  "status" "document_status" DEFAULT 'active' NOT NULL,
  "notes" text
);
--> statement-breakpoint

CREATE TABLE "entity_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "from_entity_type" "entity_type" NOT NULL,
  "from_entity_id" uuid NOT NULL,
  "kind" "entity_relationship_kind" NOT NULL,
  "to_entity_type" "entity_type" NOT NULL,
  "to_entity_id" uuid NOT NULL,
  "notes" text
);
--> statement-breakpoint

CREATE TABLE "entity_custom_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "entity_type" "entity_type" NOT NULL,
  "entity_id" uuid NOT NULL,
  "form_field_id" uuid NOT NULL,
  "value" jsonb NOT NULL
);
--> statement-breakpoint

CREATE TABLE "entity_activity_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "entity_type" "entity_type" NOT NULL,
  "entity_id" uuid NOT NULL,
  "actor_id" uuid,
  "kind" text NOT NULL,
  "summary" text NOT NULL,
  "payload" jsonb DEFAULT '{}' NOT NULL,
  "is_achievement" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint

-- ── 5. Form Builder ───────────────────────────────────────────────────────

CREATE TABLE "form_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "entity_type" "entity_type" NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "version" integer DEFAULT 1 NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "notes" text
);
--> statement-breakpoint

CREATE TABLE "form_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "form_template_id" uuid NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "help_text" text,
  "type" "form_field_type" NOT NULL,
  "is_required" boolean DEFAULT false NOT NULL,
  "is_unique" boolean DEFAULT false NOT NULL,
  "default_value" jsonb,
  "options" jsonb,
  "visibility_roles" text[],
  "order_index" integer DEFAULT 0 NOT NULL,
  "is_table_column" boolean DEFAULT false NOT NULL,
  "default_table_visible" boolean DEFAULT false NOT NULL,
  "is_searchable" boolean DEFAULT false NOT NULL,
  CONSTRAINT "form_fields_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint

CREATE TABLE "form_field_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "form_field_id" uuid NOT NULL,
  "actor_id" uuid,
  "kind" "form_field_change_kind" NOT NULL,
  "diff" jsonb DEFAULT '{}' NOT NULL,
  "notes" text
);
--> statement-breakpoint

-- ── 6. RBAC ───────────────────────────────────────────────────────────────

CREATE TABLE "role_capabilities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "role" "user_role" NOT NULL,
  "capability" text NOT NULL,
  "granted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint

-- ── 7. User table preferences ─────────────────────────────────────────────

CREATE TABLE "user_table_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "user_id" uuid NOT NULL,
  "table_key" text NOT NULL,
  "view_name" text,
  "visible_columns" text[],
  "filters" jsonb,
  "sort" jsonb,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_shared" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint

-- ── 8. Foreign keys ───────────────────────────────────────────────────────

ALTER TABLE "vendors" ADD CONSTRAINT "vendors_account_manager_id_users_id_fk"
  FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_archived_by_users_id_fk"
  FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_reports_to_employee_id_employees_id_fk"
  FOREIGN KEY ("reports_to_employee_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_archived_by_users_id_fk"
  FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_employee_id_employees_id_fk"
  FOREIGN KEY ("lead_employee_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_manager_id_users_id_fk"
  FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_archived_by_users_id_fk"
  FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_archived_by_users_id_fk"
  FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "entity_documents" ADD CONSTRAINT "entity_documents_document_id_documents_id_fk"
  FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "entity_documents" ADD CONSTRAINT "entity_documents_supersedes_id_entity_documents_id_fk"
  FOREIGN KEY ("supersedes_id") REFERENCES "public"."entity_documents"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "entity_custom_values" ADD CONSTRAINT "entity_custom_values_form_field_id_form_fields_id_fk"
  FOREIGN KEY ("form_field_id") REFERENCES "public"."form_fields"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_template_id_form_templates_id_fk"
  FOREIGN KEY ("form_template_id") REFERENCES "public"."form_templates"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "form_field_changes" ADD CONSTRAINT "form_field_changes_form_field_id_form_fields_id_fk"
  FOREIGN KEY ("form_field_id") REFERENCES "public"."form_fields"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "form_field_changes" ADD CONSTRAINT "form_field_changes_actor_id_users_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "user_table_preferences" ADD CONSTRAINT "user_table_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- ── 9. Indexes ────────────────────────────────────────────────────────────

CREATE INDEX "vendors_status_index" ON "vendors" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vendors_account_manager_id_index" ON "vendors" USING btree ("account_manager_id");--> statement-breakpoint
CREATE INDEX "vendors_name_index" ON "vendors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "vendors_is_archived_index" ON "vendors" USING btree ("is_archived");--> statement-breakpoint

CREATE INDEX "employees_status_index" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "employees_user_id_index" ON "employees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employees_work_email_index" ON "employees" USING btree ("work_email");--> statement-breakpoint
CREATE INDEX "employees_full_name_index" ON "employees" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "employees_reports_to_employee_id_index" ON "employees" USING btree ("reports_to_employee_id");--> statement-breakpoint
CREATE INDEX "employees_is_archived_index" ON "employees" USING btree ("is_archived");--> statement-breakpoint

CREATE INDEX "projects_client_id_index" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_lead_employee_id_index" ON "projects" USING btree ("lead_employee_id");--> statement-breakpoint
CREATE INDEX "projects_status_index" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_name_index" ON "projects" USING btree ("name");--> statement-breakpoint
CREATE INDEX "projects_is_archived_index" ON "projects" USING btree ("is_archived");--> statement-breakpoint

CREATE INDEX "clients_is_archived_index" ON "clients" USING btree ("is_archived");--> statement-breakpoint

CREATE INDEX "entity_contacts_entity_type_entity_id_index" ON "entity_contacts" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "entity_contacts_email_index" ON "entity_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "entity_contacts_phone_index" ON "entity_contacts" USING btree ("phone");--> statement-breakpoint

CREATE INDEX "entity_addresses_entity_type_entity_id_index" ON "entity_addresses" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "entity_addresses_kind_index" ON "entity_addresses" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "entity_addresses_state_code_index" ON "entity_addresses" USING btree ("state_code");--> statement-breakpoint

CREATE INDEX "entity_bank_accounts_entity_type_entity_id_index" ON "entity_bank_accounts" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "entity_bank_accounts_ifsc_index" ON "entity_bank_accounts" USING btree ("ifsc");--> statement-breakpoint

CREATE INDEX "entity_tax_identifiers_entity_type_entity_id_index" ON "entity_tax_identifiers" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "entity_tax_identifiers_kind_index" ON "entity_tax_identifiers" USING btree ("kind");--> statement-breakpoint

CREATE INDEX "entity_documents_entity_type_entity_id_index" ON "entity_documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "entity_documents_document_id_index" ON "entity_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "entity_documents_kind_index" ON "entity_documents" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "entity_documents_status_index" ON "entity_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "entity_documents_supersedes_id_index" ON "entity_documents" USING btree ("supersedes_id");--> statement-breakpoint

CREATE INDEX "entity_relationships_from_entity_type_from_entity_id_index" ON "entity_relationships" USING btree ("from_entity_type","from_entity_id");--> statement-breakpoint
CREATE INDEX "entity_relationships_to_entity_type_to_entity_id_index" ON "entity_relationships" USING btree ("to_entity_type","to_entity_id");--> statement-breakpoint
CREATE INDEX "entity_relationships_kind_index" ON "entity_relationships" USING btree ("kind");--> statement-breakpoint

CREATE INDEX "entity_custom_values_entity_type_entity_id_index" ON "entity_custom_values" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "entity_custom_values_form_field_id_index" ON "entity_custom_values" USING btree ("form_field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_custom_values_entity_field_unique"
  ON "entity_custom_values" USING btree ("entity_type","entity_id","form_field_id");--> statement-breakpoint

CREATE INDEX "entity_activity_log_entity_type_entity_id_created_at_index"
  ON "entity_activity_log" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "entity_activity_log_actor_id_created_at_index"
  ON "entity_activity_log" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "entity_activity_log_kind_index" ON "entity_activity_log" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "entity_activity_log_is_achievement_index" ON "entity_activity_log" USING btree ("is_achievement");--> statement-breakpoint

CREATE INDEX "form_templates_entity_type_is_active_index" ON "form_templates" USING btree ("entity_type","is_active");--> statement-breakpoint
CREATE INDEX "form_templates_entity_type_version_index" ON "form_templates" USING btree ("entity_type","version");--> statement-breakpoint

CREATE INDEX "form_fields_form_template_id_order_index_index"
  ON "form_fields" USING btree ("form_template_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "form_fields_form_template_id_key_unique"
  ON "form_fields" USING btree ("form_template_id","key");--> statement-breakpoint

CREATE INDEX "form_field_changes_form_field_id_created_at_index"
  ON "form_field_changes" USING btree ("form_field_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "form_field_changes_kind_index" ON "form_field_changes" USING btree ("kind");--> statement-breakpoint

CREATE UNIQUE INDEX "role_capabilities_role_capability_unique"
  ON "role_capabilities" USING btree ("role","capability");--> statement-breakpoint
CREATE INDEX "role_capabilities_role_index" ON "role_capabilities" USING btree ("role");--> statement-breakpoint
CREATE INDEX "role_capabilities_capability_index" ON "role_capabilities" USING btree ("capability");--> statement-breakpoint

CREATE UNIQUE INDEX "user_table_preferences_user_table_view_unique"
  ON "user_table_preferences" USING btree ("user_id","table_key","view_name");--> statement-breakpoint
CREATE INDEX "user_table_preferences_user_id_table_key_index"
  ON "user_table_preferences" USING btree ("user_id","table_key");--> statement-breakpoint
CREATE INDEX "user_table_preferences_table_key_is_shared_index"
  ON "user_table_preferences" USING btree ("table_key","is_shared");
