const API = '/admin/api';
const TOKEN_KEY = 'writeai_panel_token';
const THEME_KEY = 'writeai_panel_theme';

let token = localStorage.getItem(TOKEN_KEY) || '';
let usersPage = 1;
let usagePage = 1;
let auditPage = 1;
let currentTab = 'overview';
let chartInstances = {};

const PAGE_META = {
  overview: { title: 'Overview', subtitle: 'Platform metrics at a glance' },
  analytics: { title: 'Analytics', subtitle: 'Revenue, costs, and usage trends' },
  activity: { title: 'Activity', subtitle: 'Live feed and admin audit trail' },
  users: { title: 'Users', subtitle: 'Manage accounts, plans, and access' },
  subscriptions: { title: 'Subscriptions', subtitle: 'Stripe billing overview' },
  usage: { title: 'Usage Logs', subtitle: 'AI action history and token usage' },
  models: { title: 'AI Config', subtitle: 'Models, providers, and plan limits' },
  system: { title: 'System', subtitle: 'Health checks and extension announcements' },
  account: { title: 'Admin Settings', subtitle: 'Your profile and account security' }
};

const VALID_TABS = ['overview', 'analytics', 'activity', 'users', 'subscriptions', 'usage', 'models', 'system', 'account'];

const CHART_COLORS = ['#7c3aed', '#6366f1', '#0891b2', '#059669', '#d97706', '#db2777', '#4f46e5', '#0d9488'];

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

function chartTextColor() {
  return document.documentElement.dataset.theme === 'light' ? '#52525b' : '#a1a1aa';
}

function chartGridColor() {
  return document.documentElement.dataset.theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
}

function renderSparklineSvg(rows, color = '#6366f1') {
  if (!rows.length) return '';
  const values = rows.map((r) => r.count);
  const max = Math.max(...values, 1);
  const w = 120;
  const h = 32;
  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return `<svg class="stat-sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="2" points="${points}"/></svg>`;
}

function trendPct(current, previous) {
  if (!previous) return current ? { text: `+${current} vs last month`, dir: 'up' } : { text: 'No prior data', dir: 'neutral' };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct > 0) return { text: `+${pct}% vs last month`, dir: 'up' };
  if (pct < 0) return { text: `${pct}% vs last month`, dir: 'down' };
  return { text: 'Flat vs last month', dir: 'neutral' };
}

function renderLineChart(canvasId, labels, values, label = 'Actions') {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === 'undefined') return;

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.12)',
        fill: true,
        tension: 0.35,
        pointRadius: labels.length > 20 ? 0 : 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: chartTextColor(), maxTicksLimit: 8 }, grid: { color: chartGridColor() } },
        y: { beginAtZero: true, ticks: { color: chartTextColor() }, grid: { color: chartGridColor() } }
      }
    }
  });
}

function renderDonutChart(canvasId, labels, values) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === 'undefined') return;

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: CHART_COLORS.slice(0, labels.length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: chartTextColor(), padding: 14, usePointStyle: true }
        }
      }
    }
  });
}

function renderBarChartCanvas(canvasId, labels, values, colors) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === 'undefined') return;

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors || CHART_COLORS.slice(0, labels.length),
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: chartTextColor() }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: chartTextColor() }, grid: { color: chartGridColor() } }
      }
    }
  });
}

function fillDailyGaps(rows, days) {
  const map = new Map(rows.map((r) => [String(r.day).slice(0, 10), r.count]));
  const labels = [];
  const values = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    values.push(map.get(key) || 0);
  }
  return { labels, values };
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function updateAdminUI(admin) {
  const name = admin.display_name || admin.username;
  document.getElementById('admin-name').textContent = name;
  document.getElementById('admin-username').textContent = `@${admin.username}`;
  document.getElementById('admin-avatar').textContent = name.charAt(0).toUpperCase();
}

function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('hidden', false);
  el.style.borderColor = isError ? 'rgba(239,68,68,0.4)' : '';
  el.style.color = isError ? '#fca5a5' : '#86efac';
  setTimeout(() => el.classList.add('hidden'), 3200);
}

const DIALOG_SVGS = {
  danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
};

let dialogResolve = null;
let dialogOpen = false;

function openModalAnimated(modal) {
  modal.classList.remove('hidden', 'closing');
  requestAnimationFrame(() => modal.classList.add('is-open'));
}

function closeModalAnimated(modal) {
  modal.classList.remove('is-open');
  modal.classList.add('closing');
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('closing');
  }, 180);
}

function showAppDialog({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'info',
  showCancel = true
}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('app-dialog');
    const iconEl = document.getElementById('dialog-icon');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const cancelBtn = document.getElementById('dialog-cancel');
    const confirmBtn = document.getElementById('dialog-confirm');

    iconEl.className = `dialog-icon ${variant}`;
    iconEl.innerHTML = DIALOG_SVGS[variant] || DIALOG_SVGS.info;
    titleEl.textContent = title;
    messageEl.innerHTML = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    cancelBtn.classList.toggle('hidden', !showCancel);
    confirmBtn.className = `btn ${variant === 'danger' ? 'btn-danger-solid' : 'btn-primary'}`;

    dialogResolve = resolve;
    dialogOpen = true;
    openModalAnimated(modal);
    confirmBtn.focus();
  });
}

function closeAppDialog(result) {
  if (!dialogOpen) return;
  dialogOpen = false;
  closeModalAnimated(document.getElementById('app-dialog'));
  const resolve = dialogResolve;
  dialogResolve = null;
  setTimeout(() => resolve?.(result), 180);
}

function confirmDialog(options) {
  return showAppDialog({ showCancel: true, ...options }).then((result) => result === true);
}

function alertDialog(options) {
  return showAppDialog({
    showCancel: false,
    confirmText: 'Got it',
    ...options
  });
}

function initDialogHandlers() {
  const modal = document.getElementById('app-dialog');
  document.getElementById('dialog-confirm').addEventListener('click', () => closeAppDialog(true));
  document.getElementById('dialog-cancel').addEventListener('click', () => closeAppDialog(false));
  modal.querySelector('[data-dialog-dismiss]').addEventListener('click', () => closeAppDialog(false));
}

function showLogin(error) {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  const errEl = document.getElementById('login-error');
  if (error) {
    errEl.textContent = error;
    errEl.classList.remove('hidden');
  } else {
    errEl.classList.add('hidden');
  }
}

function showApp(admin) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateAdminUI(admin);
}

function getTabFromHash() {
  const hash = window.location.hash.replace(/^#/, '').trim();
  return VALID_TABS.includes(hash) ? hash : 'overview';
}

function setTabHash(tab) {
  const nextHash = `#${tab}`;
  if (window.location.hash !== nextHash) {
    history.replaceState(null, '', `${window.location.pathname}${nextHash}`);
  }
}

function setPageMeta(tab) {
  const meta = PAGE_META[tab] || PAGE_META.overview;
  document.getElementById('page-title').textContent = meta.title;
  document.getElementById('page-subtitle').textContent = meta.subtitle;
}

function clearTabHash() {
  history.replaceState(null, '', window.location.pathname);
}

async function switchTab(tab, { updateHash = true } = {}) {
  const safeTab = VALID_TABS.includes(tab) ? tab : 'overview';
  currentTab = safeTab;

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === safeTab);
  });
  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.id === `tab-${safeTab}`);
  });

  setPageMeta(safeTab);
  if (updateHash) setTabHash(safeTab);
  await loadTab(safeTab);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 || res.status === 403) {
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    showLogin(data.message || 'Session expired. Please sign in.');
    throw new Error('auth');
  }

  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

function renderBarChart(containerId, rows, labelKey, valueKey) {
  const el = document.getElementById(containerId);
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state"><p>No data for this period yet.<br>Usage will appear once users run AI actions.</p></div>';
    return;
  }

  const max = Math.max(...rows.map((r) => r[valueKey]), 1);
  el.innerHTML = `<div class="bar-chart">${rows.map((r) => {
    const pct = Math.round((r[valueKey] / max) * 100);
    const label = r[labelKey] || 'unknown';
    const val = typeof r[valueKey] === 'number' && r[valueKey] < 1 && r[valueKey] > 0
      ? r[valueKey].toFixed(4) : r[valueKey];
    return `<div class="bar-row">
      <div class="bar-label" title="${label}">${label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-value">${val}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderTable(containerId, columns, rows, emptyText = 'No data') {
  const el = document.getElementById(containerId);
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state"><p>${emptyText}</p></div>`;
    return;
  }

  const thead = columns.map((c) => `<th>${c.label}</th>`).join('');
  const tbody = rows.map((row) => {
    const cells = columns.map((c) => `<td>${c.render(row)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  el.innerHTML = `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function renderPagination(containerId, pagination, onPage) {
  const el = document.getElementById(containerId);
  if (!pagination || pagination.pages <= 1) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = '';
  for (let p = 1; p <= pagination.pages; p++) {
    const btn = document.createElement('button');
    btn.className = `btn btn-secondary btn-sm${p === pagination.page ? '' : ''}`;
    btn.textContent = String(p);
    btn.disabled = p === pagination.page;
    btn.onclick = () => onPage(p);
    el.appendChild(btn);
  }
}

function userInitials(row) {
  const src = row.name || row.email || '?';
  return src.charAt(0).toUpperCase();
}

async function loadOverview() {
  const days = document.getElementById('overview-days')?.value || 30;
  const data = await api(`/stats?days=${days}`);
  const s = data.users;
  const u = data.usage;
  const charts = data.charts || {};
  const trend = trendPct(charts.trends?.actions_this_month || 0, charts.trends?.actions_prev_month || 0);
  const spark = renderSparklineSvg(charts.sparkline_7d || []);

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card" style="--accent-color: linear-gradient(90deg,#6366f1,#818cf8)">
      <div class="stat-top"><span class="stat-label">Total Users</span><div class="stat-icon">👥</div></div>
      <div class="stat-value">${s.total}</div>
      <div class="stat-meta">${data.new_users_7d} new this week</div>
      ${spark}
    </div>
    <div class="stat-card" style="--accent-color: linear-gradient(90deg,#7c3aed,#a78bfa)">
      <div class="stat-top"><span class="stat-label">Pro Users</span><div class="stat-icon">⭐</div></div>
      <div class="stat-value">${s.pro}</div>
      <div class="stat-meta">${s.total ? Math.round((s.pro / s.total) * 100) : 0}% conversion</div>
    </div>
    <div class="stat-card" style="--accent-color: linear-gradient(90deg,#0891b2,#22d3ee)">
      <div class="stat-top"><span class="stat-label">Free Users</span><div class="stat-icon">🆓</div></div>
      <div class="stat-value">${s.free}</div>
      <div class="stat-meta">${s.active} active accounts</div>
    </div>
    <div class="stat-card" style="--accent-color: linear-gradient(90deg,#059669,#34d399)">
      <div class="stat-top"><span class="stat-label">Actions</span><div class="stat-icon">⚡</div></div>
      <div class="stat-value">${u.total_actions}</div>
      <div class="stat-meta">${u.month} · this month</div>
      <div class="stat-trend ${trend.dir}">${trend.text}</div>
    </div>
  `;

  const daily = fillDailyGaps(charts.daily_actions || [], Number(days));
  renderLineChart('daily-line-chart', daily.labels, daily.values);

  const plans = charts.plan_split || [];
  renderDonutChart(
    'plan-donut-chart',
    plans.map((p) => p.plan || 'unknown'),
    plans.map((p) => p.count)
  );

  renderBarChart('model-chart', u.by_model, 'model', 'count');
  renderBarChart('action-chart', charts.by_action?.length ? charts.by_action : u.by_action, 'action', 'count');
}

async function loadAnalytics() {
  const days = document.getElementById('analytics-days')?.value || 30;
  const data = await api(`/analytics?days=${days}`);

  document.getElementById('analytics-kpis').innerHTML = `
    <div class="stat-card" style="--accent-color: linear-gradient(90deg,#059669,#34d399)">
      <div class="stat-top"><span class="stat-label">Est. MRR</span><div class="stat-icon">💰</div></div>
      <div class="stat-value">$${data.mrr_usd}</div>
      <div class="stat-meta">${data.users.pro} pro × $7/mo</div>
    </div>
    <div class="stat-card" style="--accent-color: linear-gradient(90deg,#d97706,#fbbf24)">
      <div class="stat-top"><span class="stat-label">Est. AI Cost</span><div class="stat-icon">🤖</div></div>
      <div class="stat-value">$${data.estimated_ai_cost_usd}</div>
      <div class="stat-meta">${data.usage.total_actions} actions · ${days}d</div>
    </div>
    <div class="stat-card" style="--accent-color: linear-gradient(90deg,#6366f1,#818cf8)">
      <div class="stat-top"><span class="stat-label">Margin Est.</span><div class="stat-icon">📈</div></div>
      <div class="stat-value">$${data.margin_estimate_usd}</div>
      <div class="stat-meta">${data.conversion_rate}% conversion · ${data.avg_actions_per_user} avg/user</div>
    </div>
  `;

  renderBarChartCanvas(
    'revenue-cost-chart',
    ['MRR', 'AI Cost', 'Margin'],
    [data.mrr_usd, data.estimated_ai_cost_usd, Math.max(0, data.margin_estimate_usd)],
    ['#22c55e', '#f59e0b', '#6366f1']
  );

  renderBarChart('cost-by-model', data.cost_by_model, 'model', 'estimated_cost_usd');

  renderTable('top-users-table', [
    { label: 'Email', render: (r) => r.email },
    { label: 'Actions', render: (r) => r.actions }
  ], data.top_users, 'No usage in this period');
}

function renderFeed(containerId, events, emptyText) {
  const el = document.getElementById(containerId);
  if (!events.length) {
    el.innerHTML = `<div class="empty-state"><p>${emptyText}</p></div>`;
    return;
  }

  el.innerHTML = events.map((ev) => `
    <div class="feed-item">
      <div class="feed-icon">${ev.icon || '•'}</div>
      <div class="feed-body">
        <div class="feed-label">${ev.label || ev.action || '—'}</div>
        <div class="feed-meta">${formatDateTime(ev.created_at)}${ev.model ? ` · ${ev.model}` : ''}${ev.type ? ` · ${ev.type}` : ''}</div>
      </div>
    </div>
  `).join('');
}

async function loadActivity() {
  const [activity, audit] = await Promise.all([
    api('/activity'),
    api(`/audit?page=${auditPage}`)
  ]);

  renderFeed('activity-feed', activity.events, 'No recent activity yet');
  renderAuditLog(audit);
}

function renderAuditLog(data) {
  const logs = data.logs.map((log) => ({
    icon: '🔒',
    label: `<span class="audit-action">${log.action}</span> · ${log.admin_username}${log.entity_type ? ` · ${log.entity_type}` : ''}${log.entity_id ? ` #${String(log.entity_id).slice(0, 8)}` : ''}`,
    created_at: log.created_at
  }));
  renderFeed('audit-log', logs, 'No audit entries yet');
  renderPagination('audit-pagination', data.pagination, (p) => {
    auditPage = p;
    api(`/audit?page=${p}`).then(renderAuditLog);
  });
}

async function loadSystem() {
  const [health, announcement] = await Promise.all([
    api('/health'),
    api('/announcement')
  ]);

  const badge = document.getElementById('health-overall');
  badge.textContent = health.overall;
  badge.className = `health-badge ${health.overall}`;

  document.getElementById('health-checks').innerHTML = Object.entries(health.checks).map(([name, check]) => `
    <div class="health-item">
      <div>
        <div class="health-name"><span class="status-dot ${check.status}"></span>${name}</div>
        <div class="health-detail">${check.message || check.status}${check.latency_ms != null ? ` · ${check.latency_ms}ms` : ''}</div>
      </div>
      <span class="health-badge ${check.status === 'skipped' ? 'warning' : check.status}">${check.status}</span>
    </div>
  `).join('');

  const uptime = health.uptime_seconds;
  const hrs = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  document.getElementById('health-meta').innerHTML = `
    <span>Env: ${health.environment}</span>
    <span>Uptime: ${hrs}h ${mins}m</span>
    <span>v${health.version}</span>
  `;

  const ann = announcement.announcement || {};
  document.getElementById('announcement-enabled').checked = !!ann.enabled;
  document.getElementById('announcement-type').value = ann.type || 'info';
  document.getElementById('announcement-message').value = ann.message || '';
}

async function saveAnnouncement(e) {
  e.preventDefault();
  await api('/announcement', {
    method: 'PATCH',
    body: JSON.stringify({
      enabled: document.getElementById('announcement-enabled').checked,
      type: document.getElementById('announcement-type').value,
      message: document.getElementById('announcement-message').value.trim()
    })
  });
  showToast('Announcement saved');
}

async function exportWithAuth(path, filename) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    showToast('Export failed', true);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Export downloaded');
}

async function updateUser(id, payload) {
  await api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  showToast('User updated');
  await loadUsers(usersPage);
}

async function deleteUser(id, email) {
  const ok = await confirmDialog({
    title: 'Delete user?',
    message: `This will permanently remove <strong>${email}</strong>. This action cannot be undone.`,
    confirmText: 'Delete user',
    cancelText: 'Keep user',
    variant: 'danger'
  });
  if (!ok) return;
  await api(`/users/${id}`, { method: 'DELETE' });
  showToast('User deleted');
  await loadUsers(usersPage);
}

async function loadUsers(page = 1) {
  usersPage = page;
  const search = document.getElementById('user-search').value.trim();
  const plan = document.getElementById('user-plan-filter').value;
  const params = new URLSearchParams({ page, limit: 20 });
  if (search) params.set('search', search);
  if (plan) params.set('plan', plan);

  const data = await api(`/users?${params}`);

  renderTable('users-table', [
    {
      label: 'User',
      render: (r) => `<div class="user-cell">
        <div class="user-avatar">${r.avatar_url ? `<img src="${r.avatar_url}" alt="">` : userInitials(r)}</div>
        <div><div>${r.email}</div><div style="font-size:11px;color:var(--text-dim)">${r.name || '—'}</div></div>
      </div>`
    },
    { label: 'Plan', render: (r) => `<span class="badge badge-${r.plan}">${r.plan}</span>` },
    { label: 'Actions', render: (r) => r.actions_this_month },
    { label: 'Status', render: (r) => `<span class="badge ${r.is_active ? 'badge-active' : 'badge-inactive'}">${r.is_active ? 'Active' : 'Disabled'}</span>` },
    { label: 'Joined', render: (r) => new Date(r.created_at).toLocaleDateString() },
    {
      label: '',
      render: (r) => `<div class="action-group">
        <button class="btn btn-sm btn-secondary" data-plan="${r.id}">${r.plan === 'pro' ? '→ Free' : '→ Pro'}</button>
        <button class="btn btn-sm btn-secondary" data-toggle="${r.id}" data-active="${r.is_active}">${r.is_active ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-sm btn-danger" data-delete="${r.id}" data-email="${r.email}">Delete</button>
      </div>`
    }
  ], data.users, 'No users found');

  document.querySelectorAll('[data-plan]').forEach((btn) => {
    btn.onclick = async () => {
      const row = data.users.find((u) => u.id === btn.dataset.plan);
      await updateUser(btn.dataset.plan, { plan: row.plan === 'pro' ? 'free' : 'pro' });
    };
  });

  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.onclick = async () => {
      await updateUser(btn.dataset.toggle, { is_active: btn.dataset.active !== 'true' });
    };
  });

  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = () => deleteUser(btn.dataset.delete, btn.dataset.email);
  });

  renderPagination('users-pagination', data.pagination, loadUsers);
}

async function loadSubscriptions() {
  const data = await api('/subscriptions');
  renderTable('subscriptions-table', [
    { label: 'Email', render: (r) => r.email },
    { label: 'Plan', render: (r) => `<span class="badge badge-${r.plan}">${r.plan}</span>` },
    { label: 'Status', render: (r) => r.subscription_status || '—' },
    { label: 'Stripe ID', render: (r) => `<code style="font-size:11px">${r.stripe_customer_id || '—'}</code>` },
    { label: 'Updated', render: (r) => new Date(r.updated_at).toLocaleDateString() }
  ], data.subscriptions, 'No subscriptions yet');
}

async function loadUsage(page = 1) {
  usagePage = page;
  const monthInput = document.getElementById('usage-month');
  const month = monthInput.value || new Date().toISOString().slice(0, 7);
  if (!monthInput.value) monthInput.value = month;

  const search = document.getElementById('usage-search')?.value.trim() || '';
  const action = document.getElementById('usage-action')?.value.trim() || '';
  const model = document.getElementById('usage-model')?.value.trim() || '';

  const params = new URLSearchParams({ page, limit: 50, month });
  if (search) params.set('search', search);
  if (action) params.set('action', action);
  if (model) params.set('model', model);

  const data = await api(`/usage?${params}`);
  renderTable('usage-table', [
    { label: 'User', render: (r) => r.email || r.user_id },
    { label: 'Action', render: (r) => r.action.replace(/_/g, ' ') },
    { label: 'Model', render: (r) => r.model || '—' },
    { label: 'Tokens', render: (r) => `${r.input_tokens || 0} / ${r.output_tokens || 0}` },
    { label: 'Time', render: (r) => new Date(r.created_at).toLocaleString() }
  ], data.usage, 'No usage logs for this month');

  renderPagination('usage-pagination', data.pagination, loadUsage);
}

let customModels = [];
let builtinModels = [];

function syncCustomSelectMenu(selectEl) {
  const wrapper = selectEl?.closest('.custom-select');
  if (!wrapper) return;
  const menu = wrapper.querySelector('.custom-select-menu');
  menu.innerHTML = '';
  [...selectEl.options].forEach((option) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-select-option';
    btn.dataset.value = option.value;
    btn.textContent = option.text;
    if (option.selected) btn.classList.add('is-selected');
    btn.addEventListener('click', () => {
      selectEl.value = option.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      refreshCustomSelectLabels();
      wrapper.classList.remove('is-open');
      resetCustomSelectMenu(wrapper);
    });
    menu.appendChild(btn);
  });
  refreshCustomSelectLabels();
}

function populateModelSelects(allModels, primary, fallback) {
  const options = allModels.map((m) =>
    `<option value="${m.id}">${m.label || m.id} (${m.provider})</option>`
  ).join('');

  const primaryEl = document.getElementById('setting-primary');
  const fallbackEl = document.getElementById('setting-fallback');
  primaryEl.innerHTML = options;
  fallbackEl.innerHTML = options;
  primaryEl.value = primary;
  fallbackEl.value = fallback;
  syncCustomSelectMenu(primaryEl);
  syncCustomSelectMenu(fallbackEl);
}

function renderCustomModelsList() {
  const el = document.getElementById('custom-models-list');
  if (!customModels.length) {
    el.innerHTML = '<div class="empty-models">No custom models yet. Click "+ Add model".</div>';
    return;
  }

  el.innerHTML = customModels.map((m, i) => `
    <div class="custom-model-row" data-index="${i}">
      <input type="text" class="cm-id" value="${m.id}" placeholder="model-id">
      <select class="cm-provider">
        <option value="openai" ${m.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
        <option value="gemini" ${m.provider === 'gemini' ? 'selected' : ''}>Gemini</option>
      </select>
      <input type="text" class="cm-label" value="${m.label || m.id}" placeholder="Display label">
      <button type="button" class="btn btn-sm btn-danger cm-remove">✕</button>
    </div>
  `).join('');

  el.querySelectorAll('.cm-remove').forEach((btn) => {
    btn.onclick = () => {
      customModels.splice(Number(btn.closest('.custom-model-row').dataset.index), 1);
      renderCustomModelsList();
    };
  });
}

function readCustomModelsFromDom() {
  return [...document.querySelectorAll('.custom-model-row')].map((row) => ({
    id: row.querySelector('.cm-id').value.trim(),
    provider: row.querySelector('.cm-provider').value,
    label: row.querySelector('.cm-label').value.trim()
  })).filter((m) => m.id);
}

async function loadSettings() {
  const data = await api('/settings');
  const models = data.settings.models;
  const limits = data.settings.limits;
  const keys = data.settings.api_keys;

  builtinModels = data.builtin_models || [];
  customModels = models.custom_models || [];

  const allModels = [...builtinModels, ...customModels.filter(
    (c) => !builtinModels.some((b) => b.id === c.id)
  )];

  populateModelSelects(allModels, models.primary, models.fallback);
  document.getElementById('setting-gpt-enabled').checked = models.gpt_enabled;
  document.getElementById('setting-gemini-enabled').checked = models.gemini_enabled;
  document.getElementById('setting-free-limit').value = limits.free_monthly_actions;

  document.getElementById('openai-key-hint').textContent = keys.openai.configured
    ? `(saved ${keys.openai.hint})` : '';
  document.getElementById('gemini-key-hint').textContent = keys.gemini.configured
    ? `(saved ${keys.gemini.hint})` : '';

  document.getElementById('setting-openai-key').value = '';
  document.getElementById('setting-gemini-key').value = '';

  renderCustomModelsList();
  initCustomSelects();
  document.getElementById('setting-primary') && syncCustomSelectMenu(document.getElementById('setting-primary'));
  document.getElementById('setting-fallback') && syncCustomSelectMenu(document.getElementById('setting-fallback'));
  document.querySelectorAll('.custom-model-row select.cm-provider:not([data-custom-wrapped])').forEach(wrapCustomSelect);
}

async function saveModels(e) {
  e.preventDefault();
  await api('/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      models: {
        primary: document.getElementById('setting-primary').value,
        fallback: document.getElementById('setting-fallback').value,
        gpt_enabled: document.getElementById('setting-gpt-enabled').checked,
        gemini_enabled: document.getElementById('setting-gemini-enabled').checked
      }
    })
  });
  showToast('Model settings saved');
}

async function saveLimits(e) {
  e.preventDefault();
  await api('/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      limits: {
        free_monthly_actions: parseInt(document.getElementById('setting-free-limit').value, 10)
      }
    })
  });
  showToast('Plan limits saved');
}

async function saveKeys(e) {
  e.preventDefault();
  const payload = {};
  const openai = document.getElementById('setting-openai-key').value.trim();
  const gemini = document.getElementById('setting-gemini-key').value.trim();
  if (openai) payload.openai = openai;
  if (gemini) payload.gemini = gemini;

  if (!Object.keys(payload).length) {
    showToast('Enter at least one key to update', true);
    return;
  }

  await api('/settings', {
    method: 'PATCH',
    body: JSON.stringify({ api_keys: payload })
  });
  showToast('API keys saved');
  await loadSettings();
}

async function saveCustomModels(e) {
  e.preventDefault();
  const models = readCustomModelsFromDom();
  await api('/settings', {
    method: 'PATCH',
    body: JSON.stringify({ models: { custom_models: models } })
  });
  customModels = models;
  showToast('Custom models saved');
  await loadSettings();
}

function addCustomModelRow() {
  if (document.querySelector('.empty-models')) {
    customModels = [{ id: '', provider: 'openai', label: '' }];
  } else {
    customModels = readCustomModelsFromDom();
    customModels.push({ id: '', provider: 'openai', label: '' });
  }
  renderCustomModelsList();
  const rows = document.querySelectorAll('.custom-model-row');
  rows[rows.length - 1]?.querySelector('.cm-id')?.focus();
}

async function loadAccountSettings() {
  const data = await api('/account');
  const admin = data.admin;

  document.getElementById('account-display-name').value = admin.display_name || admin.username;
  document.getElementById('account-username').value = admin.username;
  document.getElementById('account-last-login').textContent = formatDateTime(admin.last_login_at);
  document.getElementById('account-created').textContent = formatDateTime(admin.created_at);
  document.getElementById('account-session').textContent = data.session_expires_in;
}

async function saveProfile(e) {
  e.preventDefault();
  const display_name = document.getElementById('account-display-name').value.trim();
  const data = await api('/account', {
    method: 'PATCH',
    body: JSON.stringify({ display_name })
  });
  updateAdminUI(data.admin);
  showToast('Profile updated');
}

async function savePassword(e) {
  e.preventDefault();
  const current_password = document.getElementById('account-current-password').value;
  const new_password = document.getElementById('account-new-password').value;
  const confirm = document.getElementById('account-confirm-password').value;

  if (new_password !== confirm) {
    showToast('New passwords do not match', true);
    return;
  }

  try {
    await api('/account/password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password })
    });
    document.getElementById('password-form').reset();
    showToast('Password updated');
  } catch (err) {
    showToast(err.message || 'Could not update password', true);
  }
}

async function loadTab(tab) {
  if (tab === 'overview') await loadOverview();
  if (tab === 'analytics') await loadAnalytics();
  if (tab === 'activity') await loadActivity();
  if (tab === 'users') await loadUsers();
  if (tab === 'subscriptions') await loadSubscriptions();
  if (tab === 'usage') await loadUsage();
  if (tab === 'models') await loadSettings();
  if (tab === 'system') await loadSystem();
  if (tab === 'account') await loadAccountSettings();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  document.getElementById('theme-icon-dark').classList.toggle('hidden', theme === 'light');
  document.getElementById('theme-icon-light').classList.toggle('hidden', theme !== 'light');
  refreshCustomSelectLabels();
}

const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';

function refreshCustomSelectLabels() {
  document.querySelectorAll('.custom-select').forEach((wrapper) => {
    const select = wrapper.querySelector('select');
    const label = wrapper.querySelector('.custom-select-label');
    if (select && label) {
      label.textContent = select.options[select.selectedIndex]?.text || '';
    }
    wrapper.querySelectorAll('.custom-select-option').forEach((opt) => {
      opt.classList.toggle('is-selected', opt.dataset.value === select.value);
    });
  });
}

function positionCustomSelectMenu(wrapper) {
  const menu = wrapper.querySelector('.custom-select-menu');
  const trigger = wrapper.querySelector('.custom-select-trigger');
  if (!menu || !trigger) return;

  menu.style.visibility = 'hidden';
  menu.style.opacity = '1';
  menu.style.transform = 'none';
  const menuHeight = Math.min(menu.scrollHeight, 280);
  menu.style.visibility = '';

  const rect = trigger.getBoundingClientRect();
  const gap = 6;
  const spaceBelow = window.innerHeight - rect.bottom - gap;
  const spaceAbove = rect.top - gap;

  menu.style.left = `${Math.max(8, rect.left)}px`;
  menu.style.width = `${rect.width}px`;

  if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    wrapper.classList.add('open-up');
    menu.style.top = `${Math.max(8, rect.top - menuHeight - gap)}px`;
  } else {
    wrapper.classList.remove('open-up');
    menu.style.top = `${rect.bottom + gap}px`;
  }
}

function resetCustomSelectMenu(wrapper) {
  const menu = wrapper.querySelector('.custom-select-menu');
  if (!menu) return;
  menu.style.top = '';
  menu.style.left = '';
  menu.style.width = '';
  wrapper.classList.remove('open-up');
}

function closeAllCustomSelects(except) {
  document.querySelectorAll('.custom-select.is-open').forEach((el) => {
    if (el !== except) {
      el.classList.remove('is-open');
      resetCustomSelectMenu(el);
    }
  });
}

function wrapCustomSelect(selectEl) {
  if (!selectEl || selectEl.dataset.customWrapped) return;

  selectEl.dataset.customWrapped = '1';
  selectEl.classList.add('native-select-hidden');

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';
  if (selectEl.classList.contains('range-select')) wrapper.classList.add('range-select-wrap');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.innerHTML = `<span class="custom-select-label"></span>${CHEVRON_SVG}`;

  const menu = document.createElement('div');
  menu.className = 'custom-select-menu';

  [...selectEl.options].forEach((option) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-select-option';
    btn.dataset.value = option.value;
    btn.textContent = option.text;
    if (option.selected) btn.classList.add('is-selected');
    btn.addEventListener('click', () => {
      selectEl.value = option.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      refreshCustomSelectLabels();
      wrapper.classList.remove('is-open');
      resetCustomSelectMenu(wrapper);
    });
    menu.appendChild(btn);
  });

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = wrapper.classList.contains('is-open');
    closeAllCustomSelects();
    wrapper.classList.toggle('is-open', !isOpen);
    if (wrapper.classList.contains('is-open')) {
      requestAnimationFrame(() => positionCustomSelectMenu(wrapper));
    } else {
      resetCustomSelectMenu(wrapper);
    }
  });

  window.addEventListener('resize', () => {
    if (wrapper.classList.contains('is-open')) positionCustomSelectMenu(wrapper);
  });

  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);
  wrapper.appendChild(trigger);
  wrapper.appendChild(menu);
  refreshCustomSelectLabels();
}

function initCustomSelects() {
  document.querySelectorAll(
    'select.range-select, #user-plan-filter, #announcement-type, #setting-primary, #setting-fallback, .cm-provider'
  ).forEach(wrapCustomSelect);

  if (!window.__customSelectBound) {
    window.__customSelectBound = true;
    document.addEventListener('click', () => closeAllCustomSelects());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllCustomSelects();
    });
  }
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  if (currentTab === 'overview' || currentTab === 'analytics') {
    loadTab(currentTab);
  }
}

function openShortcuts() {
  openModalAnimated(document.getElementById('shortcuts-modal'));
}

function closeShortcuts() {
  closeModalAnimated(document.getElementById('shortcuts-modal'));
}

function handleGlobalKeydown(e) {
  if (dialogOpen && e.key === 'Escape') {
    e.preventDefault();
    closeAppDialog(false);
    return;
  }

  if (dialogOpen && e.key === 'Enter') {
    e.preventDefault();
    closeAppDialog(true);
    return;
  }

  if (e.target.matches('input, textarea, select') && e.key !== 'Escape') return;

  if (e.key === 'Escape') {
    closeShortcuts();
    return;
  }

  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault();
    openShortcuts();
    return;
  }

  if (e.key === 'r' || e.key === 'R') {
    if (document.getElementById('app').classList.contains('hidden')) return;
    e.preventDefault();
    document.getElementById('refresh-btn').click();
    return;
  }

  if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    toggleTheme();
    return;
  }

  const tabIndex = parseInt(e.key, 10);
  if (tabIndex >= 1 && tabIndex <= VALID_TABS.length) {
    e.preventDefault();
    switchTab(VALID_TABS[tabIndex - 1]);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-submit');
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showLogin(data.message || 'Invalid credentials');
      return;
    }

    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    showApp(data.admin);
    await switchTab(getTabFromHash(), { updateHash: false });
  } catch {
    showLogin('Could not connect to server.');
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  initDialogHandlers();
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  initCustomSelects();
  updateClock();
  setInterval(updateClock, 1000);

  document.getElementById('export-users-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    exportWithAuth('/export/users', 'writeai-users.csv');
  });

  document.getElementById('export-usage-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const month = document.getElementById('usage-month')?.value || new Date().toISOString().slice(0, 7);
    exportWithAuth(`/export/usage?month=${month}`, `writeai-usage-${month}.csv`);
  });

  document.getElementById('overview-days')?.addEventListener('change', () => loadOverview());
  document.getElementById('analytics-days')?.addEventListener('change', () => loadAnalytics());
  document.getElementById('usage-filter-btn')?.addEventListener('click', () => loadUsage(1));
  document.getElementById('audit-refresh')?.addEventListener('click', () => loadActivity());
  document.getElementById('announcement-form')?.addEventListener('submit', saveAnnouncement);
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('shortcuts-btn')?.addEventListener('click', openShortcuts);
  document.getElementById('shortcuts-close')?.addEventListener('click', closeShortcuts);
  document.querySelector('.modal-backdrop')?.addEventListener('click', closeShortcuts);
  document.addEventListener('keydown', handleGlobalKeydown);

  if (!token) {
    showLogin();
    return;
  }

  try {
    const data = await api('/auth/me');
    showApp(data.admin);
    await switchTab(getTabFromHash(), { updateHash: false });
  } catch {
    showLogin();
  }
}

window.addEventListener('hashchange', () => {
  if (!token || document.getElementById('app').classList.contains('hidden')) return;
  switchTab(getTabFromHash(), { updateHash: false });
});

function updateClock() {
  const el = document.getElementById('live-clock');
  if (el) el.textContent = new Date().toLocaleString();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

document.getElementById('login-form').addEventListener('submit', handleLogin);

document.getElementById('logout-btn').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: 'You will need to sign in again to access the master panel.',
    confirmText: 'Sign out',
    cancelText: 'Stay signed in',
    variant: 'logout'
  });
  if (!ok) return;
  token = '';
  localStorage.removeItem(TOKEN_KEY);
  clearTabHash();
  showLogin();
});

document.getElementById('refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    await switchTab(currentTab, { updateHash: false });
    showToast('Data refreshed');
  } catch {
    /* auth errors handled in api() */
  } finally {
    setTimeout(() => {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }, 700);
  }
});
document.getElementById('user-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUsers(); });
document.getElementById('user-plan-filter').addEventListener('change', () => loadUsers());
document.getElementById('usage-month').addEventListener('change', () => loadUsage());
document.getElementById('usage-search')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUsage(1); });
document.getElementById('settings-form').addEventListener('submit', saveModels);
document.getElementById('limits-form').addEventListener('submit', saveLimits);
document.getElementById('keys-form').addEventListener('submit', saveKeys);
document.getElementById('custom-models-form').addEventListener('submit', saveCustomModels);
document.getElementById('add-model-btn').addEventListener('click', addCustomModelRow);
document.getElementById('profile-form').addEventListener('submit', saveProfile);
document.getElementById('password-form').addEventListener('submit', savePassword);

init();
