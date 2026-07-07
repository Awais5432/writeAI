ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage(model);

CREATE TABLE app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (key, value) VALUES
  ('models', '{"primary":"gpt-4o-mini","fallback":"gemini-2.0-flash","gpt_enabled":true,"gemini_enabled":true}'::jsonb),
  ('limits', '{"free_monthly_actions":20}'::jsonb)
ON CONFLICT (key) DO NOTHING;
