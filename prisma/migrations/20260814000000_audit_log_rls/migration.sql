-- Enable Row Level Security on AuditLog table
-- Note: Prisma maps model AuditLog → table "AuditLog" (PascalCase, no snake_case mapping)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

-- Create policy to allow SELECT and INSERT for all authenticated database roles
CREATE POLICY "Allow select and insert on AuditLog"
    ON "AuditLog"
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Prevent UPDATE and DELETE to enforce append-only legal compliance
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AuditLog records are append-only. UPDATE and DELETE operations are strictly prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_mutation ON "AuditLog";

CREATE TRIGGER trg_prevent_audit_log_mutation
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
