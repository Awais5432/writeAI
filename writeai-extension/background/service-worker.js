const API_BASE = 'http://localhost:3000';

const CONTEXT_ACTIONS = [
  { id: 'fix_grammar', title: 'Fix grammar & spelling' },
  { id: 'rephrase', title: 'Rephrase' },
  { id: 'translate', title: 'Translate…' },
  { id: 'summarize', title: 'Summarize' },
  { id: 'explain', title: 'Explain' }
];

function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'writeai_root',
      title: 'WriteAI',
      contexts: ['selection']
    });
    CONTEXT_ACTIONS.forEach((action) => {
      chrome.contextMenus.create({
        id: `writeai_${action.id}`,
        parentId: 'writeai_root',
        title: action.title,
        contexts: ['selection']
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(buildContextMenus);
chrome.runtime.onStartup.addListener(buildContextMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.menuItemId.startsWith('writeai_')) return;
  const action = info.menuItemId.replace('writeai_', '');
  if (!CONTEXT_ACTIONS.some((a) => a.id === action)) return;

  const payload = {
    type: 'CONTEXT_ACTION',
    action,
    text: (info.selectionText || '').trim()
  };

  chrome.tabs.sendMessage(tab.id, payload).catch(() => {
    // Content script may not be injected yet (e.g. page loaded before install).
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content/content.js'] },
      () => chrome.tabs.sendMessage(tab.id, payload).catch(() => {})
    );
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RUN_ACTION') {
    handleAction(message).then(sendResponse);
    return true;
  }
  if (message.type === 'OPEN_AUTH') {
    openAuthTab();
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'GET_USER') {
    getUser().then(sendResponse);
    return true;
  }
  if (message.type === 'CHECKOUT') {
    createCheckout().then(sendResponse);
    return true;
  }
  if (message.type === 'PORTAL') {
    openPortal().then(sendResponse);
    return true;
  }
  if (message.type === 'GET_ANNOUNCEMENT') {
    getAnnouncement().then(sendResponse);
    return true;
  }
  if (message.type === 'SIGN_OUT') {
    chrome.storage.local.remove('token').then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === 'WRITEAI_AUTH' && message.token) {
    chrome.storage.local.set({ token: message.token }).then(() => {
      sendResponse?.({ ok: true });
    });
    return true;
  }
});

async function getToken() {
  const { token } = await chrome.storage.local.get('token');
  return token;
}

async function apiFetch(path, options = {}) {
  const token = await getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function handleAction({ action, text, extra }) {
  const token = await getToken();

  if (!token) {
    openAuthTab();
    return { error: 'not_authenticated' };
  }

  try {
    const { ok, data } = await apiFetch('/action', {
      method: 'POST',
      body: JSON.stringify({ action, text, extra })
    });

    if (!ok) return { error: data.error, message: data.message };
    return { result: data.result };
  } catch (err) {
    return { error: 'network_error' };
  }
}

async function getAnnouncement() {
  try {
    const { ok, data } = await apiFetch('/user/announcement');
    if (!ok || !data.announcement) return { announcement: null };
    return { announcement: data.announcement };
  } catch {
    return { announcement: null };
  }
}

async function getUser() {
  const token = await getToken();
  if (!token) return { error: 'not_authenticated' };

  const { ok, data } = await apiFetch('/user/me');
  if (!ok) return { error: data.error || 'fetch_failed' };
  return { user: data };
}

async function createCheckout() {
  const { ok, data } = await apiFetch('/billing/checkout', { method: 'POST' });
  if (!ok) return { error: data.error || 'checkout_failed', message: data.message };
  return { url: data.url };
}

async function openPortal() {
  const { ok, data } = await apiFetch('/billing/portal', { method: 'POST' });
  if (!ok) return { error: data.error || 'portal_failed', message: data.message };
  return { url: data.url };
}

function openAuthTab() {
  chrome.tabs.create({ url: `${API_BASE}/auth/google?extensionId=${chrome.runtime.id}` });
}
