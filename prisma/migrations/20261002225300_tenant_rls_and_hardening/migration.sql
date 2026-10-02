-- ============================================================================
-- Tenant isolation at the database layer, plus integrity hardening.
--
-- Every table that has a "tenantId" column gets row-level security. A row is
-- visible/writable only when:
--   * app.tenant_id  = the row's tenantId        (tenant-scoped client), or
--   * app.bypass_rls = 'on'                       (explicit platform client)
-- Both settings are transaction-local (set_config(..., true)) and are set by the
-- application's database layer, never by request input.
--
-- The application must connect as a role WITHOUT superuser / BYPASSRLS. FORCE ROW
-- LEVEL SECURITY is applied so that even the table owner is subject to policies.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_tenant_matches(row_tenant text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.bypass_rls', true) = 'on'
      OR (row_tenant IS NOT NULL
          AND row_tenant = NULLIF(current_setting('app.tenant_id', true), ''))
$$;

-- Idempotent: re-run (SELECT apply_tenant_rls()) in any later migration that adds
-- a tenant-owned table. tests/db/rls.test.ts fails if a tenantId table lacks RLS.
CREATE OR REPLACE FUNCTION apply_tenant_rls() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_tenant_matches("tenantId")) WITH CHECK (app_tenant_matches("tenantId"))',
      t.table_name);
  END LOOP;
END $$;

SELECT apply_tenant_rls();

-- The tenants table is keyed by "id" rather than "tenantId".
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (app_tenant_matches(id)) WITH CHECK (app_tenant_matches(id));

-- Audit log: platform events have a NULL tenantId and are visible to the platform
-- client only (app_tenant_matches(NULL) is false unless bypass is on).

-- ---------------------------------------------------------------------------
-- Append-only audit log
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- Check constraints for money / quantity / ranges
-- ---------------------------------------------------------------------------
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK ("amountCents" > 0);
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_nonneg
  CHECK ("totalCents" >= 0 AND "amountPaidCents" >= 0 AND "subtotalCents" >= 0 AND "taxCents" >= 0);
ALTER TABLE invoices ADD CONSTRAINT invoices_due_after_issue CHECK ("dueDate" >= "issueDate");
ALTER TABLE quotes ADD CONSTRAINT quotes_amounts_nonneg
  CHECK ("totalCents" >= 0 AND "subtotalCents" >= 0 AND "taxCents" >= 0);
ALTER TABLE appointments ADD CONSTRAINT appointments_time_order CHECK ("endsAt" > "startsAt");
ALTER TABLE appointment_assignees ADD CONSTRAINT appointment_assignees_time_order CHECK ("endsAt" > "startsAt");
ALTER TABLE employee_availability ADD CONSTRAINT availability_range
  CHECK (weekday BETWEEN 0 AND 6 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
ALTER TABLE time_off ADD CONSTRAINT time_off_order CHECK ("endsAt" > "startsAt");
ALTER TABLE tenant_settings ADD CONSTRAINT tax_rate_range CHECK ("defaultTaxRateBp" BETWEEN 0 AND 10000);
ALTER TABLE quotes ADD CONSTRAINT quote_tax_rate_range CHECK ("taxRateBp" BETWEEN 0 AND 10000);
ALTER TABLE invoices ADD CONSTRAINT invoice_tax_rate_range CHECK ("taxRateBp" BETWEEN 0 AND 10000);
ALTER TABLE expenses ADD CONSTRAINT expenses_amount_positive CHECK ("amountCents" > 0);

-- Prevent double-booking one technician with overlapping appointments at the DB
-- level (belt and braces; the scheduling service also warns first).
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- Cancelled/no-show appointments release the slot, so exclusion is enforced in the
-- service layer (it needs status awareness); we only index for the overlap query.
CREATE INDEX appointment_assignees_overlap_idx
  ON appointment_assignees USING gist ("tenantId", "employeeId", tsrange("startsAt", "endsAt"));

-- ---------------------------------------------------------------------------
-- Grants for the application role (created out-of-band; see docs/ARCHITECTURE.md).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worklio_app') THEN
    GRANT USAGE ON SCHEMA public TO worklio_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO worklio_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO worklio_app;
    -- Audit trail is insert/select only for the application.
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM worklio_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO worklio_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO worklio_app;
  END IF;
END $$;
