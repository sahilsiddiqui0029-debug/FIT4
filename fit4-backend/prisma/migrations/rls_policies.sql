-- ─────────────────────────────────────────────────────────────────────────────
-- FIT4.in PostgreSQL Row-Level Security (RLS) Policies
-- Enforces strict tenant/patient isolation on User, HealthLog, Subscription,
-- and AuditLog tables per DPDP Act 2026 & Master Security Audit Section 4.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enable and Force Row-Level Security on all patient/health tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;

ALTER TABLE "HealthLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HealthLog" FORCE ROW LEVEL SECURITY;

ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;

-- 2. User Table Policies: Patients can only read/update their own record;
--    Doctors can read records only where consentGiven = true.
DROP POLICY IF EXISTS "user_self_select" ON "User";
CREATE POLICY "user_self_select" ON "User"
  FOR SELECT
  USING (
    id = COALESCE(current_setting('app.current_user_id', true), auth.uid()::text)
    OR (
      COALESCE(current_setting('app.current_user_role', true), '') IN ('doctor', 'admin')
      AND "consentGiven" = true
    )
  );

DROP POLICY IF EXISTS "user_self_update" ON "User";
CREATE POLICY "user_self_update" ON "User"
  FOR UPDATE
  USING (id = COALESCE(current_setting('app.current_user_id', true), auth.uid()::text))
  WITH CHECK (id = COALESCE(current_setting('app.current_user_id', true), auth.uid()::text));

-- 3. HealthLog Table Policies: Strict ownership on SELECT/INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "healthlog_owner_or_consented_doctor_select" ON "HealthLog";
CREATE POLICY "healthlog_owner_or_consented_doctor_select" ON "HealthLog"
  FOR SELECT
  USING (
    "userId" = COALESCE(current_setting('app.current_user_id', true), auth.uid()::text)
    OR (
      COALESCE(current_setting('app.current_user_role', true), '') IN ('doctor', 'admin')
      AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u.id = "HealthLog"."userId"
          AND u."consentGiven" = true
      )
    )
  );

DROP POLICY IF EXISTS "healthlog_owner_insert" ON "HealthLog";
CREATE POLICY "healthlog_owner_insert" ON "HealthLog"
  FOR INSERT
  WITH CHECK ("userId" = COALESCE(current_setting('app.current_user_id', true), auth.uid()::text));

DROP POLICY IF EXISTS "healthlog_owner_delete" ON "HealthLog";
CREATE POLICY "healthlog_owner_delete" ON "HealthLog"
  FOR DELETE
  USING ("userId" = COALESCE(current_setting('app.current_user_id', true), auth.uid()::text));

-- 4. Subscription Table Policies: Owner read-only, service_role write-only
DROP POLICY IF EXISTS "subscription_owner_select" ON "Subscription";
CREATE POLICY "subscription_owner_select" ON "Subscription"
  FOR SELECT
  USING ("userId" = COALESCE(current_setting('app.current_user_id', true), auth.uid()::text));

-- 5. AuditLog Table Policies: Append-only for application, read-only for security admins
DROP POLICY IF EXISTS "auditlog_insert_only" ON "AuditLog";
CREATE POLICY "auditlog_insert_only" ON "AuditLog"
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "auditlog_admin_select" ON "AuditLog";
CREATE POLICY "auditlog_admin_select" ON "AuditLog"
  FOR SELECT
  USING (COALESCE(current_setting('app.current_user_role', true), '') = 'admin');
