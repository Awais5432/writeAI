(function () {
  const $ = (id) => document.getElementById(id);

  let user = null;
  let models = [];
  let currentChatId = null;
  let chats = loadChats();
  let selectedLength = 'medium';
  let isSending = false;
  let pendingAttachments = [];

  const PROMPTS = {
    short: 'Keep the response brief — 1-2 short paragraphs or a few bullet points.',
    medium: 'Provide a balanced response with enough detail to be useful.',
    long: 'Provide a thorough, detailed response with structure and examples where helpful.'
  };

  function loadChats() {
    try { return JSON.parse(localStorage.getItem('writeai_chats') || '[]'); }
    catch { return []; }
  }

  function saveChats() {
    localStorage.setItem('writeai_chats', JSON.stringify(chats.slice(0, 30)));
  }

  const THEME_KEY = 'writeai_web_theme';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    $('theme-icon-dark')?.classList.toggle('hidden', theme === 'light');
    $('theme-icon-light')?.classList.toggle('hidden', theme !== 'light');
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  }

  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  function initials(name, email) {
    const src = name || email || 'U';
    return src.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function captureTokenFromHash() {
    const hash = location.hash.slice(1);
    if (!hash.startsWith('token=')) return;
    const token = decodeURIComponent(hash.slice(6));
    WriteAIApi.setToken(token);
    history.replaceState(null, '', location.pathname + location.search);
  }

  async function requireAuth() {
    captureTokenFromHash();
    if (!WriteAIApi.getToken()) {
      location.href = '/login';
      return false;
    }

    const { ok, data } = await WriteAIApi.apiFetch('/auth/verify');
    if (!ok) {
      WriteAIApi.setToken('');
      location.href = '/login';
      return false;
    }
    return true;
  }

  async function loadUser() {
    const [meRes, modelsRes] = await Promise.all([
      WriteAIApi.apiFetch('/user/me'),
      WriteAIApi.apiFetch('/user/models')
    ]);

    if (!meRes.ok) throw new Error('Failed to load profile');
    user = meRes.data;
    models = modelsRes.ok ? modelsRes.data.models : [];

    renderUser();
    renderModels();
    renderBilling();
    handleQueryParams();
  }

  function renderUser() {
    const isPro = user.plan === 'pro';
    const name = user.name || user.email.split('@')[0];

    $('sidebar-name').textContent = name;
    $('sidebar-plan').textContent = isPro ? 'Pro plan' : 'Free plan';
    $('settings-name').textContent = name;
    $('settings-email').textContent = user.email;

    const badge = $('plan-badge');
    badge.textContent = isPro ? 'Pro' : 'Free';
    badge.className = `badge ${isPro ? 'badge-pro' : 'badge-free'}`;

    $('settings-plan').textContent = isPro ? 'Pro — Unlimited' : 'Free';

    const avatarEl = $('sidebar-avatar');
    if (user.avatar_url) {
      avatarEl.innerHTML = `<img src="${user.avatar_url}" alt="">`;
    } else {
      avatarEl.textContent = initials(user.name, user.email);
    }

    if (isPro || user.usage.limit === null) {
      $('usage-text').textContent = 'Unlimited actions';
      $('usage-bar-wrap').classList.add('hidden');
    } else {
      const { count, limit } = user.usage;
      $('usage-text').textContent = `${count} / ${limit} actions`;
      const pct = Math.min(100, Math.round((count / limit) * 100));
      $('usage-bar-fill').style.width = `${pct}%`;
      $('usage-bar-wrap').classList.remove('hidden');
    }
  }

  function renderModels() {
    const sel = $('model-select');
    sel.innerHTML = '';
    if (!models.length) {
      sel.innerHTML = '<option value="">Default model</option>';
      return;
    }
    models.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label || m.id;
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderBilling() {
    const wrap = $('billing-actions');
    wrap.innerHTML = '';
    const isPro = user.plan === 'pro';
    const hasBilling = user.has_billing;

    if (!isPro) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Upgrade to Pro — $7/mo';
      btn.addEventListener('click', startCheckout);
      wrap.appendChild(btn);
      return;
    }

    if (hasBilling) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.textContent = 'Manage billing';
      btn.addEventListener('click', openPortal);
      wrap.appendChild(btn);
    } else {
      const note = document.createElement('p');
      note.className = 'security-note';
      note.textContent = 'Your Pro plan was assigned by an admin. No billing account is linked.';
      wrap.appendChild(note);
    }
  }

  async function startCheckout() {
    const { ok, data } = await WriteAIApi.apiFetch('/billing/checkout', { method: 'POST' });
    if (!ok) return showToast(data.message || 'Could not start checkout.');
    location.href = data.url;
  }

  async function openPortal() {
    const { ok, data } = await WriteAIApi.apiFetch('/billing/portal', { method: 'POST' });
    if (!ok) return showToast(data.message || 'Could not open billing portal.');
    location.href = data.url;
  }

  function handleQueryParams() {
    const params = new URLSearchParams(location.search);
    if (params.get('upgraded') === '1') {
      showToast('Welcome to Pro! You now have unlimited actions.');
      history.replaceState(null, '', '/app');
      loadUser();
    }
    if (params.get('billing') === 'cancel') {
      showToast('Checkout canceled.');
      history.replaceState(null, '', '/app');
    }
    if (params.get('view') === 'settings') showSettings();
  }

  function showChat() {
    $('chat-view').classList.remove('hidden');
    $('settings-view').classList.add('hidden');
    $('view-title').textContent = 'Chat';
    $('nav-chat').classList.add('active');
  }

  function showSettings() {
    $('chat-view').classList.add('hidden');
    $('settings-view').classList.remove('hidden');
    $('view-title').textContent = 'Settings';
    $('nav-chat').classList.remove('active');
  }

  function newChat() {
    currentChatId = null;
    $('chat-messages').innerHTML = `
      <div class="chat-empty" id="chat-empty">
        <h2>How can we help you today?</h2>
        <div class="prompt-grid">
          <button class="prompt-card" data-prompt="Draft a polite follow-up email checking on a job application.">Draft a polite follow-up email checking on a job application.</button>
          <button class="prompt-card" data-prompt="Write a short LinkedIn post announcing a product launch.">Write a short LinkedIn post announcing a product launch.</button>
          <button class="prompt-card" data-prompt="Improve this sentence to sound more professional: Thanks for getting back to me so fast.">Improve this sentence to sound more professional.</button>
          <button class="prompt-card" data-prompt="Summarize the key points of a meeting about Q3 planning.">Summarize the key points of a meeting about Q3 planning.</button>
        </div>
      </div>`;
    bindPromptCards();
    renderHistory();
    showChat();
  }

  function bindPromptCards() {
    document.querySelectorAll('.prompt-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('chat-input').value = btn.dataset.prompt;
        updateSendState();
        sendMessage();
      });
    });
  }

  function renderHistory() {
    const list = $('history-list');
    list.innerHTML = '<div class="history-label">Recent</div>';
    chats.forEach((chat) => {
      const btn = document.createElement('button');
      btn.className = `history-item${chat.id === currentChatId ? ' active' : ''}`;
      btn.textContent = chat.title;
      btn.addEventListener('click', () => openChat(chat.id));
      list.appendChild(btn);
    });
  }

  function openChat(id) {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    currentChatId = id;
    $('chat-empty')?.remove();
    $('chat-messages').innerHTML = '';
    chat.messages.forEach((m) => appendMessage(m.role, m.content, false, m.attachments || []));
    renderHistory();
    showChat();
  }

  function appendMessage(role, content, scroll = true, attachments = []) {
    $('chat-empty')?.remove();
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;
    const avatarText = role === 'user' ? initials(user.name, user.email) : 'W';
    const attachHtml = renderAttachmentsHtml(attachments);
    wrap.innerHTML = `
      <div class="msg-avatar">${role === 'assistant' ? 'W' : avatarText}</div>
      <div class="msg-body">${attachHtml}${formatContent(content, role)}</div>`;
    $('chat-messages').appendChild(wrap);
    if (scroll) $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
    return wrap;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(text) {
    if (!text) return '';

    const codeBlocks = [];
    let src = text.replace(/```([\s\S]*?)```/g, (_, code) => {
      const i = codeBlocks.length;
      codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
      return `\x00CB${i}\x00`;
    });

    const lines = src.split('\n');
    const out = [];
    let inUl = false;
    let inOl = false;

    function closeLists() {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    }

    function inline(s) {
      return escapeHtml(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }

    for (const raw of lines) {
      const line = raw.trimEnd();
      const trimmed = line.trim();

      if (!trimmed) { closeLists(); continue; }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        closeLists();
        out.push('<hr>');
        continue;
      }

      const h = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (h) {
        closeLists();
        const level = h[1].length;
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
        continue;
      }

      if (trimmed.startsWith('> ')) {
        closeLists();
        out.push(`<blockquote><p>${inline(trimmed.slice(2))}</p></blockquote>`);
        continue;
      }

      const ul = trimmed.match(/^[-*]\s+(.+)$/);
      if (ul) {
        if (!inUl) { closeLists(); out.push('<ul>'); inUl = true; }
        out.push(`<li>${inline(ul[1])}</li>`);
        continue;
      }

      const ol = trimmed.match(/^\d+\.\s+(.+)$/);
      if (ol) {
        if (!inOl) { closeLists(); out.push('<ol>'); inOl = true; }
        out.push(`<li>${inline(ol[1])}</li>`);
        continue;
      }

      closeLists();
      out.push(`<p>${inline(trimmed)}</p>`);
    }

    closeLists();

    let html = out.join('');
    html = html.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[Number(i)] || '');
    return html;
  }

  function formatContent(text, role) {
    if (role === 'assistant') return renderMarkdown(text);
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderAttachmentsHtml(attachments) {
    if (!attachments?.length) return '';
    const items = attachments.map((a) => {
      if (a.type === 'image') {
        return `<img class="msg-attach-img" src="${a.dataUrl}" alt="${escapeHtml(a.name)}">`;
      }
      return `<span class="msg-attach-file">📎 ${escapeHtml(a.name)}</span>`;
    }).join('');
    return `<div class="msg-attachments">${items}</div>`;
  }

  function ensureChat(title) {
    if (currentChatId) return chats.find((c) => c.id === currentChatId);
    const chat = {
      id: Date.now().toString(36),
      title: title.slice(0, 48) + (title.length > 48 ? '…' : ''),
      messages: [],
      updatedAt: Date.now()
    };
    chats.unshift(chat);
    currentChatId = chat.id;
    saveChats();
    renderHistory();
    return chat;
  }

  function updateSendState() {
    const input = $('chat-input');
    const hasContent = input.value.trim() || pendingAttachments.length;
    $('send-btn').disabled = !hasContent || isSending;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async function addAttachment(file) {
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isText = /\.(txt|md|csv|json)$/i.test(file.name) || file.type.startsWith('text/');

    if (!isImage && !isText && file.type !== 'application/pdf') {
      showToast('Supported: images, .txt, .md, .csv, .json');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('File must be under 5 MB.');
      return;
    }

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: file.name,
      type: isImage ? 'image' : 'file',
      mime: file.type
    };

    if (isImage) {
      item.dataUrl = await readFileAsDataUrl(file);
    } else if (isText) {
      item.textContent = await readFileAsText(file);
    } else {
      showToast('PDF preview not supported yet. Describe what you need in your message.');
      return;
    }

    pendingAttachments.push(item);
    renderAttachPreview();
    updateSendState();
  }

  function removeAttachment(id) {
    pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
    renderAttachPreview();
    updateSendState();
  }

  function renderAttachPreview() {
    const wrap = $('attach-preview');
    if (!pendingAttachments.length) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
      return;
    }

    wrap.classList.remove('hidden');
    wrap.innerHTML = pendingAttachments.map((a) => `
      <div class="attach-item" data-id="${a.id}">
        ${a.type === 'image' ? `<img src="${a.dataUrl}" alt="">` : '<span>📎</span>'}
        <span class="attach-name">${escapeHtml(a.name)}</span>
        <button class="attach-remove" type="button" data-remove="${a.id}" aria-label="Remove">×</button>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => removeAttachment(btn.dataset.remove));
    });
  }

  function buildApiText(text, attachments) {
    const parts = [text];

    attachments.forEach((a) => {
      if (a.type === 'image') {
        parts.push(`\n[User attached image: ${a.name}. Describe what you want done with this image.]`);
      } else if (a.textContent) {
        parts.push(`\n\n--- File: ${a.name} ---\n${a.textContent.slice(0, 6000)}`);
      }
    });

    return parts.filter(Boolean).join('').trim();
  }

  async function sendMessage() {
    const input = $('chat-input');
    const text = input.value.trim();
    const attachments = [...pendingAttachments];
    if ((!text && !attachments.length) || isSending) return;

    isSending = true;
    $('send-btn').disabled = true;
    input.value = '';
    pendingAttachments = [];
    renderAttachPreview();
    autoResize(input);

    const displayText = text || (attachments.some((a) => a.type === 'image') ? 'Attached image' : 'Attached file');
    const chat = ensureChat(displayText);
    chat.messages.push({ role: 'user', content: displayText, attachments });
    appendMessage('user', displayText, true, attachments);

    const loadingEl = document.createElement('div');
    loadingEl.className = 'msg assistant';
    loadingEl.innerHTML = `
      <div class="msg-avatar">W</div>
      <div class="msg-body"><div class="msg-loading"><span class="msg-spin"></span> Thinking…</div></div>`;
    $('chat-messages').appendChild(loadingEl);
    $('chat-messages').scrollTop = $('chat-messages').scrollHeight;

    const model = $('model-select').value;
    const extra = [
      PROMPTS[selectedLength],
      model ? `Prefer model: ${model}` : ''
    ].filter(Boolean).join(' ');

    const { ok, data } = await WriteAIApi.apiFetch('/action', {
      method: 'POST',
      body: JSON.stringify({ action: 'chat', text: buildApiText(text, attachments), extra })
    });

    loadingEl.remove();

    if (!ok) {
      const errMsg = data.message || 'Something went wrong. Please try again.';
      appendMessage('assistant', `⚠️ ${errMsg}`);
      isSending = false;
      updateSendState();
      return;
    }

    chat.messages.push({ role: 'assistant', content: data.result });
    chat.updatedAt = Date.now();
    saveChats();
    appendMessage('assistant', data.result);

    // Refresh usage
    const meRes = await WriteAIApi.apiFetch('/user/me');
    if (meRes.ok) { user = meRes.data; renderUser(); }

    isSending = false;
    updateSendState();
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function bindEvents() {
    $('nav-chat').addEventListener('click', newChat);
    $('account-btn').addEventListener('click', showSettings);
    $('sign-out-btn').addEventListener('click', () => {
      WriteAIApi.setToken('');
      location.href = '/login';
    });

    $('sidebar-toggle').addEventListener('click', () => {
      $('sidebar').classList.toggle('collapsed');
    });

    $('theme-toggle')?.addEventListener('click', toggleTheme);

    const input = $('chat-input');
    input.addEventListener('input', () => {
      autoResize(input);
      updateSendState();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((i) => i.type.startsWith('image/'));
      if (!imageItem) return;
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) await addAttachment(file);
    });

    $('attach-btn')?.addEventListener('click', () => $('file-input')?.click());
    $('file-input')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) await addAttachment(file);
      e.target.value = '';
    });

    $('send-btn').addEventListener('click', sendMessage);

    document.querySelectorAll('#length-group .tool-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#length-group .tool-chip').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        selectedLength = btn.dataset.length;
      });
    });

    bindPromptCards();
  }

  async function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
    const authed = await requireAuth();
    if (!authed) return;
    bindEvents();
    try {
      await loadUser();
      renderHistory();
    } catch (err) {
      showToast('Failed to load your account.');
      console.error(err);
    }
  }

  init();
})();
