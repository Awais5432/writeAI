const API_BASE = window.WRITEAI_API_BASE || '';

function getToken() {
  return localStorage.getItem('writeai_token') || '';
}

function setToken(token) {
  if (token) localStorage.setItem('writeai_token', token);
  else localStorage.removeItem('writeai_token');
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, data };
}

window.WriteAIApi = { getToken, setToken, apiFetch };
