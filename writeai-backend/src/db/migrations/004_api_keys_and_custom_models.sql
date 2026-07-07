INSERT INTO app_settings (key, value) VALUES
  ('api_keys', '{"openai":"","gemini":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Ensure models setting has custom_models array
UPDATE app_settings
SET value = value || '{"custom_models":[]}'::jsonb
WHERE key = 'models' AND NOT (value ? 'custom_models');
