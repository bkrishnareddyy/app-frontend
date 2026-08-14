-- Enable Row Level Security on audit_logs table
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- Create policy to allow SELECT and INSERT for all authenticated database roles
CREATE POLICY "Allow select and insert on audit_logs" ON "audit_logs"
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Explicitly deny UPDATE and DELETE queries on audit_logs table to enforce append-only legal compliance
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AuditLog records are append-only. UPDATE and DELETE operations are strictly prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_mutation ON "audit_logs";

CREATE TRIGGER trg_prevent_audit_log_mutation
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
