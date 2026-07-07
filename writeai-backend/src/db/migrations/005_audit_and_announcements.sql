CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES panel_admins(id) ON DELETE SET NULL,
  admin_username VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id VARCHAR(255),
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX idx_audit_log_admin ON admin_audit_log(admin_id);

INSERT INTO app_settings (key, value) VALUES
  ('announcement', '{"enabled":false,"message":"","type":"info"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
