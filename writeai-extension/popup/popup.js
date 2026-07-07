const $ = (id) => document.getElementById(id);

const signedOut = $('signed-out');
const signedIn = $('signed-in');
const loading = $('loading');

function showToast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('hidden', false);
  el.classList.toggle('is-error', isError);
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

function showState(state) {
  loading.classList.toggle('hidden', state !== 'loading');
  signedOut.classList.toggle('hidden', state !== 'signed-out');
  signedIn.classList.toggle('hidden', state !== 'signed-in');
}

function showSignedOut() {
  showState('signed-out');
}

function initialsFrom(user) {
  const src = user.name || user.email || '?';
  return src.charAt(0).toUpperCase();
}

function showSignedIn(user) {
  showState('signed-in');

  const isPro = user.plan === 'pro';
  const hasBilling = !!user.has_billing;

  // Avatar
  const avatar = $('avatar');
  const fallback = $('avatar-fallback');
  fallback.textContent = initialsFrom(user);
  if (user.avatar_url) {
    avatar.onerror = () => {
      avatar.hidden = true;
      fallback.hidden = false;
    };
    avatar.src = user.avatar_url;
    avatar.hidden = false;
    fallback.hidden = true;
  } else {
    avatar.hidden = true;
    fallback.hidden = false;
  }

  $('display-name').textContent = user.name || user.email.split('@')[0];
  $('email').textContent = user.email;

  const badge = $('plan-badge');
  badge.textContent = isPro ? '✦ Pro' : 'Free';
  badge.className = `plan-badge ${isPro ? 'plan-pro' : 'plan-free'}`;

  const usageCard = $('usage-card');
  const usageText = $('usage-text');
  const usageBar = $('usage-bar');
  const usageFill = $('usage-fill');
  const usagePct = $('usage-pct');
  const proPerks = $('pro-perks');

  if (isPro) {
    usageCard.classList.add('is-pro');
    usageText.textContent = 'Unlimited';
    usageBar.classList.add('hidden');
    usagePct.textContent = '';
    proPerks.classList.remove('hidden');
  } else {
    usageCard.classList.remove('is-pro');
    proPerks.classList.add('hidden');
    const { count, limit } = user.usage || { count: 0, limit: 20 };
    const pct = limit ? Math.round((count / limit) * 100) : 0;
    usageText.textContent = `${count} / ${limit} actions`;
    usagePct.textContent = `${pct}%`;
    usageBar.classList.remove('hidden');
    usageFill.style.width = `${Math.min(100, pct)}%`;
    usageFill.classList.toggle('is-warning', pct >= 80);
  }

  // Billing buttons — only show what's relevant
  const billingSection = $('billing-section');
  const upgradeBtn = $('upgrade-btn');
  const manageBtn = $('manage-btn');

  if (isPro) {
    // Pro via admin: no billing buttons at all
    // Pro via Stripe: show manage only
    if (hasBilling) {
      billingSection.classList.remove('hidden');
      upgradeBtn.classList.add('hidden');
      manageBtn.classList.remove('hidden');
    } else {
      billingSection.classList.add('hidden');
    }
  } else {
    // Free user: show upgrade (Stripe may or may not be configured)
    billingSection.classList.remove('hidden');
    upgradeBtn.classList.remove('hidden');
    manageBtn.classList.add('hidden');
  }
}

function showAnnouncement(announcement) {
  ['announcement-banner', 'announcement-banner-in'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (!announcement?.message) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = announcement.message;
    el.className = `announcement ${announcement.type || 'info'}`;
  });
}

$('sign-in-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_AUTH' });
  window.close();
});

$('sign-out-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
  showSignedOut();
  showToast('Signed out');
});

$('upgrade-btn').addEventListener('click', async () => {
  const btn = $('upgrade-btn');
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CHECKOUT' });
    if (res?.url) {
      chrome.tabs.create({ url: res.url });
      window.close();
    } else {
      showToast(
        res?.message || 'Billing is not configured yet. Contact support or ask your admin to enable Stripe.',
        true
      );
    }
  } finally {
    btn.disabled = false;
  }
});

$('manage-btn').addEventListener('click', async () => {
  const btn = $('manage-btn');
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'PORTAL' });
    if (res?.url) {
      chrome.tabs.create({ url: res.url });
      window.close();
    } else {
      showToast(
        res?.message || 'No billing account found. Your Pro plan was assigned by an admin.',
        true
      );
    }
  } finally {
    btn.disabled = false;
  }
});

async function init() {
  showState('loading');

  const [annRes, userRes] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_ANNOUNCEMENT' }).catch(() => ({})),
    chrome.runtime.sendMessage({ type: 'GET_USER' }).catch(() => ({}))
  ]);

  showAnnouncement(annRes?.announcement);

  if (userRes?.user) {
    showSignedIn(userRes.user);
  } else {
    showSignedOut();
  }
}

init();
