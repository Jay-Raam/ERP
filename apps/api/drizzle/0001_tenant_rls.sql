-- Tenant isolation. Hand-written; drizzle-kit does not manage roles or policies here.
--
-- The API never queries as the connection's login role. Every transaction does
--   SET LOCAL ROLE erp_app;  and  set_config('app.tenant_id', <uuid>, true)
-- erp_app is not a superuser and does not own the tables, so the policies below
-- always apply to it, even when the login role is a superuser (as on most hosts).

DO $$
BEGIN
  CREATE ROLE erp_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  -- Lets a non-superuser login role switch to erp_app. Superusers do not need it.
  EXECUTE format('GRANT erp_app TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
--> statement-breakpoint
-- Current tenant for this transaction. NULL when unset, so every policy
-- comparison is NULL and no row is visible or writable.
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
-- Call once for every new table that has a tenant_id column.
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(target regclass, tenant_column name DEFAULT 'tenant_id')
RETURNS void LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  -- FORCE makes the policy apply to the table owner as well.
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (%I = app_tenant_id()) WITH CHECK (%I = app_tenant_id())',
    target, tenant_column, tenant_column
  );
END
$$;
--> statement-breakpoint
SELECT app_enable_tenant_rls('organisations', 'id');
--> statement-breakpoint
SELECT app_enable_tenant_rls('roles');
--> statement-breakpoint
SELECT app_enable_tenant_rls('role_permissions');
--> statement-breakpoint
SELECT app_enable_tenant_rls('branches');
--> statement-breakpoint
SELECT app_enable_tenant_rls('users');
--> statement-breakpoint
SELECT app_enable_tenant_rls('user_branches');
