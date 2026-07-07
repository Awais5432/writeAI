const API_BASE = 'http://localhost:3000';

async function apiFetch(path, options = {}) {
  const { token } = await chrome.storage.local.get('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

module.exports = { apiFetch, API_BASE };
