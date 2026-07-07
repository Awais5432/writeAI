const router = require('express').Router();
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const db = require('../db/postgres');
const config = require('../config');
const authMiddleware = require('../middleware/auth');

const client = new OAuth2Client(
  config.google.clientId,
  config.google.clientSecret,
  config.google.callbackUrl
);

function parseOAuthState(state) {
  if (!state) return { extensionId: '', redirect: '' };

  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    return {
      extensionId: decoded.extensionId || '',
      redirect: decoded.redirect || ''
    };
  } catch {
    return { extensionId: state, redirect: '' };
  }
}

function buildOAuthState({ extensionId, redirect }) {
  if (redirect) {
    return Buffer.from(JSON.stringify({ extensionId: extensionId || '', redirect })).toString('base64url');
  }
  return extensionId || '';
}

function isAdminEmail(email) {
  return config.adminEmails.includes(String(email).toLowerCase());
}

router.get('/google', (req, res) => {
  if (!config.google.clientId) {
    return res.status(503).json({ error: 'Google OAuth not configured' });
  }

  const state = buildOAuthState({
    extensionId: req.query.extensionId,
    redirect: req.query.redirect
  });

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['email', 'profile'],
    state,
    prompt: 'consent'
  });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const { extensionId, redirect } = parseOAuthState(state);

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.google.clientId
    });

    const { sub: googleId, email, name, picture } = ticket.getPayload();
    const role = isAdminEmail(email) ? 'admin' : 'user';

    const result = await db.query(
      `INSERT INTO users (email, name, avatar_url, google_id, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (google_id) DO UPDATE
         SET name = EXCLUDED.name,
             avatar_url = EXCLUDED.avatar_url,
             role = CASE WHEN $6 THEN 'admin' ELSE users.role END,
             updated_at = NOW()
       RETURNING *`,
      [email, name, picture, googleId, role, isAdminEmail(email)]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    if (redirect === 'admin') {
      if (user.role !== 'admin') {
        return res.redirect('/admin/?error=not_admin');
      }
      return res.redirect(`/admin/#token=${encodeURIComponent(token)}`);
    }

    if (redirect === 'app' || redirect === 'web') {
      const base = (config.frontendUrl || '').replace(/\/$/, '');
      const target = base ? `${base}/app` : '/app';
      return res.redirect(`${target}#token=${encodeURIComponent(token)}`);
    }

    const tokenJson = JSON.stringify(token);
    const extensionIdJson = JSON.stringify(extensionId || '');

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WriteAI — Signed in</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #06060b;
      color: #f4f4f5;
      overflow: hidden;
      position: relative;
    }
    .bg {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse 70% 60% at 25% 20%, rgba(124,108,255,0.28), transparent 55%),
        radial-gradient(ellipse 60% 50% at 80% 85%, rgba(99,102,241,0.22), transparent 55%),
        #06060b;
    }
    .card {
      position: relative;
      width: 100%;
      max-width: 400px;
      margin: 24px;
      padding: 44px 36px 36px;
      text-align: center;
      background: rgba(18,18,28,0.8);
      backdrop-filter: blur(24px);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 24px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.5);
      animation: rise 0.5s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes rise { from { opacity:0; transform: translateY(16px) scale(0.97); } to { opacity:1; transform:none; } }
    .logo {
      width: 60px; height: 60px; margin: 0 auto 22px;
      border-radius: 18px;
      background: linear-gradient(135deg, #7c6cff, #5850e0);
      display: flex; align-items: center; justify-content: center;
      font-size: 28px; font-weight: 800; color: #fff;
      box-shadow: 0 10px 30px rgba(124,108,255,0.45);
    }
    .check {
      width: 72px; height: 72px; margin: 0 auto 22px;
      border-radius: 50%;
      background: rgba(34,197,94,0.14);
      border: 1px solid rgba(34,197,94,0.3);
      display: flex; align-items: center; justify-content: center;
      animation: pop 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.15s both;
    }
    @keyframes pop { from { opacity:0; transform: scale(0.5); } to { opacity:1; transform: scale(1); } }
    .check svg { width: 36px; height: 36px; stroke: #4ade80; }
    .check svg path { stroke-dasharray: 32; stroke-dashoffset: 32; animation: draw 0.4s ease 0.45s forwards; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 8px; }
    p { color: #a1a1aa; font-size: 14px; line-height: 1.6; }
    .hint {
      margin-top: 24px; padding: 12px 16px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      font-size: 13px; color: #a1a1aa;
    }
    .hint strong { color: #e9d5ff; font-weight: 600; }
    .close-note { margin-top: 16px; font-size: 12px; color: #71717a; }
    .brand-name { font-weight: 700; color: #c4b5fd; }
  </style>
</head>
<body>
  <div class="bg"></div>
  <div class="card">
    <div class="check">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </div>
    <h1>You're all set!</h1>
    <p>Signed in to <span class="brand-name">WriteAI</span> successfully.</p>
    <div class="hint">
      Head back to any page, <strong>select some text</strong>, and let WriteAI fix, rephrase, translate, and more.
    </div>
    <p class="close-note" id="close-note">This tab will close automatically…</p>
  </div>
  <script>
    (function () {
      var payload = { type: 'WRITEAI_AUTH', token: ${tokenJson} };
      var extensionId = ${extensionIdJson};

      if (window.opener) {
        window.opener.postMessage(payload, '*');
      }

      function tryClose(delay) {
        setTimeout(function () {
          window.close();
          var note = document.getElementById('close-note');
          if (note) note.textContent = 'You can close this tab now.';
        }, delay);
      }

      if (extensionId && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(extensionId, payload, function () { tryClose(1200); });
        return;
      }

      tryClose(1500);
    })();
  </script>
</body>
</html>`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    if (err.code === 'ECONNREFUSED' || err.code === '42P01') {
      return res.status(503).send(
        'Database not ready. Start PostgreSQL (docker compose up -d), run npm run migrate, then try again.'
      );
    }
    res.status(500).send('Authentication failed. Please try again.');
  }
});

router.get('/verify', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
