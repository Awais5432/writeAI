const db = require('../db/postgres');

const DEFAULTS = {
  models: {
    primary: 'gpt-4o-mini',
    fallback: 'gemini-2.5-flash-lite',
    gpt_enabled: true,
    gemini_enabled: true,
    custom_models: []
  },
  limits: {
    free_monthly_actions: 20
  },
  api_keys: {
    openai: '',
    gemini: ''
  },
  announcement: {
    enabled: false,
    message: '',
    type: 'info'
  }
};

let cache = {};
let cacheAt = 0;
const CACHE_TTL_MS = 30_000;

async function loadAll() {
  const now = Date.now();
  if (now - cacheAt < CACHE_TTL_MS && Object.keys(cache).length) {
    return cache;
  }

  const result = await db.query('SELECT key, value FROM app_settings');
  cache = { ...DEFAULTS };

  for (const row of result.rows) {
    cache[row.key] = { ...DEFAULTS[row.key], ...row.value };
  }

  cacheAt = now;
  return cache;
}

async function getSetting(key) {
  const all = await loadAll();
  return all[key] || DEFAULTS[key];
}

async function updateSetting(key, value) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
  cacheAt = 0;
  return getSetting(key);
}

function invalidateCache() {
  cacheAt = 0;
}

module.exports = {
  getSetting,
  updateSetting,
  loadAll,
  invalidateCache,
  DEFAULTS
};
