let toolbar = null;
let selectedText = '';
let savedRange = null;
let savedField = null; // { el, start, end } for input/textarea
let lastAction = null;
let isEditableSelection = false;
let dragState = null;

const ICONS = {
  fix_grammar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  rephrase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  translate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>',
  summarize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="14" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  explain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/></svg>'
};

const LABELS = {
  fix_grammar: 'Fix',
  rephrase: 'Rephrase',
  translate: 'Translate',
  summarize: 'Summarize',
  explain: 'Explain'
};

const LANGUAGES = ['Spanish', 'French', 'German', 'Urdu', 'Arabic', 'Hindi', 'Chinese', 'Japanese'];

/** User-facing messages only — never show Admin / model / billing details */
const USER_ERROR_MESSAGES = {
  free_limit_reached: 'You\'ve used all your free actions this month. Upgrade to Pro for unlimited access.',
  not_authenticated: 'Please sign in via the WriteAI popup to continue.',
  account_disabled: 'Your account has been disabled. Please contact support.',
  user_not_found: 'Please sign in again.',
  invalid_token: 'Your session expired. Please sign in again.',
  no_token: 'Please sign in via the WriteAI popup to continue.',
  ai_quota_exceeded: 'AI is temporarily busy. Please try again in a few seconds.',
  ai_unavailable: 'AI is temporarily unavailable. Please try again later.',
  ai_error: 'AI is temporarily busy. Please try again in a few seconds.',
  network_error: 'Could not reach WriteAI. Please check your connection and try again.'
};

function friendlyError(response) {
  if (!response) return USER_ERROR_MESSAGES.ai_error;
  if (response.error && USER_ERROR_MESSAGES[response.error]) {
    return USER_ERROR_MESSAGES[response.error];
  }
  const msg = response.message || '';
  // Strip any leaked admin/config wording from older server responses
  if (/admin|openai|gemini|api key|ai\.google|billing|model/i.test(msg)) {
    return USER_ERROR_MESSAGES.ai_unavailable;
  }
  if (msg) return msg;
  return USER_ERROR_MESSAGES.ai_error;
}

/** Strip markdown so Gmail / plain editors don't show ** and * */
function toPlainText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

document.addEventListener('mouseup', (e) => {
  if (toolbar?.contains(e.target)) return;
  if (dragState) return;

  setTimeout(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text && text.length > 1) {
      captureSelection(selection);
      selectedText = text;
      showToolbar();
    } else if (toolbar && !toolbar.contains(e.target)) {
      hideToolbar();
    }
  }, 10);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideToolbar();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'CONTEXT_ACTION') return;
  const selection = window.getSelection();
  const text = (msg.text || selection?.toString() || '').trim();
  if (!text) return;
  captureSelection(selection);
  selectedText = text;
  showToolbar();
  if (msg.action === 'translate') {
    openLanguagePicker();
  } else {
    runAction(msg.action);
  }
});

function captureSelection(selection) {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    && typeof active.selectionStart === 'number' && active.selectionStart !== active.selectionEnd) {
    savedField = { el: active, start: active.selectionStart, end: active.selectionEnd };
    savedRange = null;
    isEditableSelection = true;
    return;
  }
  savedField = null;
  if (selection && selection.rangeCount) {
    savedRange = selection.getRangeAt(0).cloneRange();
    isEditableSelection = isRangeEditable(savedRange);
  } else {
    savedRange = null;
    isEditableSelection = false;
  }
}

function isRangeEditable(range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  return !!(node && node.closest && node.closest('[contenteditable=""], [contenteditable="true"]'));
}

function getSelectionRect() {
  if (savedField) {
    return savedField.el.getBoundingClientRect();
  }
  if (savedRange) {
    const rect = savedRange.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) return rect;
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect && (rect.width || rect.height)) return rect;
  }
  return null;
}

function showToolbar() {
  hideToolbar();

  toolbar = document.createElement('div');
  toolbar.id = 'writeai-toolbar';
  toolbar.className = 'wa-tb';
  toolbar.innerHTML = `
    <div class="wa-head" id="wa-drag">
      <div class="wa-brand"><span class="wa-logo">W</span><span>WriteAI</span></div>
      <button class="wa-x" id="wa-close" title="Close (Esc)" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="wa-actions">
      ${Object.keys(LABELS).map((a) => `
        <button class="wa-act" data-action="${a}" title="${LABELS[a]}">
          <span class="wa-ico">${ICONS[a]}</span>
          <span>${LABELS[a]}</span>
        </button>`).join('')}
    </div>
    <div class="wa-body" id="wa-body" hidden>
      <div class="wa-loading" id="wa-loading" hidden>
        <span class="wa-spin"></span><span>Thinking…</span>
      </div>
      <div class="wa-lang" id="wa-lang" hidden>
        <div class="wa-lang-title">Translate to</div>
        <div class="wa-lang-chips">
          ${LANGUAGES.map((l) => `<button class="wa-chip" data-lang="${l}">${l}</button>`).join('')}
        </div>
        <div class="wa-lang-custom">
          <input type="text" id="wa-lang-input" placeholder="Other language…" />
          <button class="wa-btn wa-primary" id="wa-lang-go">Go</button>
        </div>
      </div>
      <div class="wa-result" id="wa-result" hidden>
        <div class="wa-result-text" id="wa-result-text"></div>
        <div class="wa-foot">
          <button class="wa-btn wa-primary" id="wa-copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy</span>
          </button>
          <button class="wa-btn" id="wa-replace">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            <span>Replace</span>
          </button>
          <button class="wa-btn wa-ghost" id="wa-regen" title="Regenerate">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>
      <div class="wa-error" id="wa-error" hidden></div>
    </div>
  `;

  document.body.appendChild(toolbar);
  positionToolbar();
  enableDrag(toolbar.querySelector('#wa-drag'));

  const replaceBtn = toolbar.querySelector('#wa-replace');
  if (replaceBtn) replaceBtn.hidden = false;

  toolbar.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      setActiveAction(action);
      if (action === 'translate') {
        openLanguagePicker();
      } else {
        runAction(action);
      }
    });
  });

  toolbar.querySelectorAll('[data-lang]').forEach((chip) => {
    chip.addEventListener('click', () => runAction('translate', chip.dataset.lang));
  });

  toolbar.querySelector('#wa-lang-go')?.addEventListener('click', () => {
    const val = toolbar.querySelector('#wa-lang-input').value.trim();
    if (val) runAction('translate', val);
  });
  toolbar.querySelector('#wa-lang-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) runAction('translate', val);
    }
  });

  toolbar.querySelector('#wa-copy')?.addEventListener('click', copyResult);
  toolbar.querySelector('#wa-replace')?.addEventListener('click', () => {
    const text = toPlainText(toolbar.querySelector('#wa-result-text').innerText);
    replaceSelectedText(text);
    hideToolbar();
  });
  toolbar.querySelector('#wa-regen')?.addEventListener('click', () => {
    if (lastAction) runAction(lastAction.action, lastAction.extra, true);
  });
  toolbar.querySelector('#wa-close')?.addEventListener('click', hideToolbar);
}

function enableDrag(handle) {
  if (!handle || !toolbar) return;

  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('#wa-close')) return;
    e.preventDefault();

    const rect = toolbar.getBoundingClientRect();
    dragState = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top
    };
    toolbar.classList.add('wa-dragging');

    const onMove = (ev) => {
      if (!dragState || !toolbar) return;
      const margin = 8;
      const tbW = toolbar.offsetWidth;
      const tbH = toolbar.offsetHeight;
      let left = ev.clientX - dragState.offsetX;
      let top = ev.clientY - dragState.offsetY;
      left = Math.max(margin, Math.min(left, window.innerWidth - tbW - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - tbH - margin));
      toolbar.style.position = 'fixed';
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${top}px`;
      toolbar.dataset.dragged = '1';
    };

    const onUp = () => {
      dragState = null;
      toolbar?.classList.remove('wa-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function setActiveAction(action) {
  toolbar.querySelectorAll('.wa-act').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.action === action);
  });
}

function positionToolbar() {
  if (!toolbar || toolbar.dataset.dragged === '1') return;

  const rect = getSelectionRect();
  const tbRect = toolbar.getBoundingClientRect();
  const margin = 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top;
  let left;

  if (rect) {
    left = rect.left + rect.width / 2 - tbRect.width / 2;
    const below = rect.bottom + margin;
    const above = rect.top - tbRect.height - margin;
    top = (below + tbRect.height < vh) ? below : Math.max(margin, above);
  } else {
    left = vw / 2 - tbRect.width / 2;
    top = vh / 2 - tbRect.height / 2;
  }

  left = Math.max(margin, Math.min(left, vw - tbRect.width - margin));
  top = Math.max(margin, Math.min(top, vh - tbRect.height - margin));

  toolbar.style.position = 'absolute';
  toolbar.style.top = `${top + window.scrollY}px`;
  toolbar.style.left = `${left + window.scrollX}px`;
}

function showBody() {
  const body = toolbar.querySelector('#wa-body');
  if (body) body.hidden = false;
}

function openLanguagePicker() {
  showBody();
  toolbar.querySelector('#wa-loading').hidden = true;
  toolbar.querySelector('#wa-result').hidden = true;
  toolbar.querySelector('#wa-error').hidden = true;
  toolbar.querySelector('#wa-lang').hidden = false;
  positionToolbar();
  toolbar.querySelector('#wa-lang-input')?.focus();
}

async function runAction(action, extra = '', forceRefresh = false) {
  lastAction = { action, extra };
  setActiveAction(action);
  showBody();

  const loading = toolbar.querySelector('#wa-loading');
  const result = toolbar.querySelector('#wa-result');
  const error = toolbar.querySelector('#wa-error');
  const lang = toolbar.querySelector('#wa-lang');

  lang.hidden = true;
  result.hidden = true;
  error.hidden = true;
  loading.hidden = false;
  positionToolbar();

  const response = await chrome.runtime.sendMessage({
    type: 'RUN_ACTION',
    action,
    text: selectedText,
    extra,
    forceRefresh
  });

  loading.hidden = true;

  if (!toolbar) return;

  if (response?.error || !response?.result) {
    error.textContent = friendlyError(response);
    error.hidden = false;
  } else {
    const plain = toPlainText(response.result);
    toolbar.querySelector('#wa-result-text').innerText = plain;
    result.hidden = false;
  }
  positionToolbar();
}

function copyResult() {
  const text = toPlainText(toolbar.querySelector('#wa-result-text').innerText);
  const btn = toolbar.querySelector('#wa-copy');
  const label = btn.querySelector('span');
  navigator.clipboard.writeText(text).then(() => {
    const prev = label.textContent;
    btn.classList.add('is-done');
    label.textContent = 'Copied!';
    setTimeout(() => {
      btn.classList.remove('is-done');
      label.textContent = prev;
    }, 1600);
  }).catch(() => {});
}

function replaceSelectedText(replacement) {
  const text = toPlainText(replacement);

  if (savedField && savedField.el) {
    const { el, start, end } = savedField;
    const value = el.value;
    el.value = value.slice(0, start) + text + value.slice(end);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    const caret = start + text.length;
    try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
    return;
  }

  const sel = window.getSelection();
  if (savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  sel.collapseToEnd();
}

function hideToolbar() {
  if (!toolbar) return;
  toolbar.classList.add('wa-closing');
  const el = toolbar;
  toolbar = null;
  dragState = null;
  setTimeout(() => el.remove(), 120);
}
