-- Migrate deprecated Gemini 1.5 / 2.0 model IDs to current Gemini 2.5 models
UPDATE app_settings
SET value = jsonb_set(
  jsonb_set(
    value,
    '{primary}',
    to_jsonb(
      CASE value->>'primary'
        WHEN 'gemini-1.5-flash' THEN 'gemini-2.5-flash'
        WHEN 'gemini-1.5-flash-002' THEN 'gemini-2.5-flash'
        WHEN 'gemini-1.5-pro' THEN 'gemini-2.5-pro'
        WHEN 'gemini-2.0-flash' THEN 'gemini-2.5-flash'
        WHEN 'gemini-2.0-flash-lite' THEN 'gemini-2.5-flash-lite'
        ELSE value->>'primary'
      END
    )
  ),
  '{fallback}',
  to_jsonb(
    CASE value->>'fallback'
      WHEN 'gemini-1.5-flash' THEN 'gemini-2.5-flash-lite'
      WHEN 'gemini-1.5-flash-002' THEN 'gemini-2.5-flash-lite'
      WHEN 'gemini-1.5-pro' THEN 'gemini-2.5-pro'
      WHEN 'gemini-2.0-flash' THEN 'gemini-2.5-flash-lite'
      WHEN 'gemini-2.0-flash-lite' THEN 'gemini-2.5-flash-lite'
      ELSE value->>'fallback'
    END
  )
),
updated_at = NOW()
WHERE key = 'models';
