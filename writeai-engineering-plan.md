# WriteAI — Engineering Plan
**Scope:** Node.js API Backend + Chrome Extension (MV3)  
**Landing page:** Handed off to frontend dev (Next.js) — out of scope here  
**AI Model:** GPT-4o mini (primary) · Gemini 2.0 Flash (fallback / A/B)  
**Stack:** Node.js · Express · PostgreSQL · Redis · Stripe · JWT · Chrome Extension MV3

---

Role Model: https://jetwriter.ai/

## What We're Building

A Chrome extension that lets users highlight text on any website (Gmail, Slack, LinkedIn, Notion, etc.) and instantly run 5 AI actions:

| Action | Description |
|--------|-------------|
| ✏️ Fix Grammar | Correct errors, clean up writing |
| 🔄 Rephrase | Rewrite in clearer / professional tone |
| 🌐 Translate | Translate to any language |
| 📋 Summarize | Condense to key points |
| 💡 Explain | Plain-language explanation |

Free tier: 20 actions/month. Pro: $7/month unlimited.

---

## System Architecture

```
┌─────────────────────────────────────────────────┐
│              Chrome Extension (MV3)              │
│  content.js → toolbar UI → background.js        │
└──────────────────────┬──────────────────────────┘
                       │ HTTPS (JWT in header)
                       ▼
┌─────────────────────────────────────────────────┐
│           Node.js / Express API                  │
│                                                  │
│  /auth     → Google OAuth + JWT                  │
│  /action   → AI proxy (GPT-4o mini)              │
│  /billing  → Stripe webhooks + subscription      │
│  /user     → usage stats, plan info              │
└──────┬───────────────┬──────────────────────────┘
       │               │
       ▼               ▼
  PostgreSQL         Redis
  (users,          (rate limiting,
   usage,           session cache,
   plans)           usage counters)
```

---

## Project Structure

```
writeai-backend/
├── src/
│   ├── routes/
│   │   ├── auth.js          # Google OAuth, JWT issue
│   │   ├── action.js        # AI action endpoint
│   │   ├── billing.js       # Stripe routes + webhooks
│   │   └── user.js          # User info, usage
│   ├── middleware/
│   │   ├── auth.js          # JWT verify middleware
│   │   └── rateLimit.js     # Redis-based rate limiter
│   ├── services/
│   │   ├── ai.js            # GPT-4o mini + Gemini adapter
│   │   ├── usage.js         # Track + enforce action limits
│   │   └── stripe.js        # Stripe helpers
│   ├── db/
│   │   ├── postgres.js      # pg pool setup
│   │   └── migrations/      # SQL migration files
│   ├── config/
│   │   └── index.js         # env vars, constants
│   └── app.js               # Express app entry
├── .env.example
├── package.json
└── README.md

writeai-extension/
├── manifest.json            # MV3 manifest
├── background/
│   └── service-worker.js    # Handles API calls, auth token storage
├── content/
│   ├── content.js           # Text selection detection, toolbar inject
│   └── toolbar.css          # Toolbar styles
├── popup/
│   ├── popup.html           # Extension popup (sign in / usage)
│   ├── popup.js
│   └── popup.css
├── icons/
│   └── icon-16/32/48/128.png
└── utils/
    └── api.js               # Fetch wrapper for backend calls
```

---

## Phase 1 — Backend Core (Week 1–2)

### 1.1 Project Setup

```bash
mkdir writeai-backend && cd writeai-backend
npm init -y
npm install express cors helmet dotenv pg redis jsonwebtoken
npm install stripe openai @google/generative-ai
npm install express-validator morgan
npm install -D nodemon
```

`.env.example`:
```
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/writeai
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-here
JWT_EXPIRES_IN=30d

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://api.writeai.com/auth/google/callback

OPENAI_API_KEY=
GEMINI_API_KEY=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=

FRONTEND_URL=https://writeai.com
EXTENSION_ORIGIN=chrome-extension://YOUR_EXTENSION_ID
```

---

### 1.2 Database Schema

```sql
-- migrations/001_init.sql

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  avatar_url TEXT,
  google_id VARCHAR(255) UNIQUE,
  plan VARCHAR(20) DEFAULT 'free',        -- 'free' | 'pro'
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  subscription_status VARCHAR(50),        -- 'active' | 'canceled' | 'past_due'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,            -- 'fix_grammar' | 'rephrase' | etc.
  model VARCHAR(50),                      -- 'gpt-4o-mini' | 'gemini-2.0-flash'
  input_tokens INT,
  output_tokens INT,
  month_year VARCHAR(7),                  -- '2026-06'  for easy monthly queries
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_user_month ON usage(user_id, month_year);

CREATE TABLE monthly_counts (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  month_year VARCHAR(7),
  action_count INT DEFAULT 0,
  PRIMARY KEY (user_id, month_year)
);
```

---

### 1.3 Express App

```js
// src/app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/auth');
const actionRoutes = require('./routes/action');
const billingRoutes = require('./routes/billing');
const userRoutes = require('./routes/user');

const app = express();

app.use(helmet());
app.use(cors({
  origin: [process.env.FRONTEND_URL, process.env.EXTENSION_ORIGIN],
  credentials: true
}));

// Stripe webhooks need raw body — mount BEFORE express.json()
app.use('/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/action', actionRoutes);
app.use('/billing', billingRoutes);
app.use('/user', userRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

module.exports = app;
```

---

## Phase 2 — Auth (Week 1–2)

### 2.1 Google OAuth Flow

```
User clicks "Sign in with Google" in extension popup
  → Opens tab: GET /auth/google
  → Google redirects to: GET /auth/google/callback
  → Server creates/finds user in DB
  → Issues JWT
  → Closes tab, sends JWT to extension via chrome.storage
```

```js
// src/routes/auth.js
const router = require('express').Router();
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const db = require('../db/postgres');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Step 1: Redirect to Google
router.get('/google', (req, res) => {
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['email', 'profile'],
    state: req.query.extensionId || ''
  });
  res.redirect(url);
});

// Step 2: Google callback
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID
  });

  const { sub: googleId, email, name, picture } = ticket.getPayload();

  // Upsert user
  const result = await db.query(`
    INSERT INTO users (email, name, avatar_url, google_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (google_id) DO UPDATE
      SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
    RETURNING *
  `, [email, name, picture, googleId]);

  const user = result.rows[0];

  const token = jwt.sign(
    { userId: user.id, email: user.email, plan: user.plan },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  // Return token to extension via postMessage on a close page
  res.send(`
    <script>
      window.opener?.postMessage({ type: 'WRITEAI_AUTH', token: '${token}' }, '*');
      window.close();
    </script>
  `);
});

// Verify token (called by extension on startup)
router.get('/verify', require('../middleware/auth'), (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
```

---

## Phase 3 — AI Action Engine (Week 2–3)

### 3.1 AI Service — GPT-4o mini + Gemini adapter

```js
// src/services/ai.js
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPTS = {
  fix_grammar: `You are a grammar expert. Fix grammar, spelling, and punctuation errors in the user's text. Return only the corrected text with no explanation.`,
  rephrase: `You are a professional editor. Rephrase the user's text to be clearer and more professional. Return only the rephrased text with no explanation.`,
  translate: `You are a professional translator. Translate the user's text to the target language they specify. Return only the translated text with no explanation.`,
  summarize: `You are an expert at condensing content. Summarize the user's text into 2-4 concise bullet points covering the key ideas. Return only the bullet points.`,
  explain: `You are a teacher. Explain the user's text in simple, plain language that anyone can understand. Return only the explanation.`
};

async function runWithGPT(action, text, extra = '') {
  const systemPrompt = SYSTEM_PROMPTS[action];
  const userContent = extra ? `${text}\n\nExtra instruction: ${extra}` : text;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    max_tokens: 500,
    temperature: 0.3
  });

  return {
    result: response.choices[0].message.content.trim(),
    model: 'gpt-4o-mini',
    input_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.completion_tokens
  };
}

async function runWithGemini(action, text, extra = '') {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const systemPrompt = SYSTEM_PROMPTS[action];
  const prompt = `${systemPrompt}\n\nText: ${text}${extra ? `\n\nExtra instruction: ${extra}` : ''}`;

  const response = await model.generateContent(prompt);
  const result = response.response.text().trim();

  return {
    result,
    model: 'gemini-2.0-flash',
    input_tokens: null, // Gemini doesn't expose token counts on flash
    output_tokens: null
  };
}

// Main export — tries GPT first, falls back to Gemini
async function runAction(action, text, extra = '', preferGemini = false) {
  if (preferGemini) return runWithGemini(action, text, extra);
  try {
    return await runWithGPT(action, text, extra);
  } catch (err) {
    console.error('GPT failed, falling back to Gemini:', err.message);
    return await runWithGemini(action, text, extra);
  }
}

module.exports = { runAction };
```

---

### 3.2 Usage Service

```js
// src/services/usage.js
const db = require('../db/postgres');

const FREE_LIMIT = 20;

async function getMonthlyCount(userId) {
  const monthYear = new Date().toISOString().slice(0, 7); // '2026-06'
  const result = await db.query(`
    SELECT action_count FROM monthly_counts
    WHERE user_id = $1 AND month_year = $2
  `, [userId, monthYear]);
  return result.rows[0]?.action_count || 0;
}

async function canPerformAction(userId, plan) {
  if (plan === 'pro') return true;
  const count = await getMonthlyCount(userId);
  return count < FREE_LIMIT;
}

async function incrementCount(userId) {
  const monthYear = new Date().toISOString().slice(0, 7);
  await db.query(`
    INSERT INTO monthly_counts (user_id, month_year, action_count)
    VALUES ($1, $2, 1)
    ON CONFLICT (user_id, month_year)
    DO UPDATE SET action_count = monthly_counts.action_count + 1
  `, [userId, monthYear]);
}

async function logUsage(userId, action, model, inputTokens, outputTokens) {
  const monthYear = new Date().toISOString().slice(0, 7);
  await db.query(`
    INSERT INTO usage (user_id, action, model, input_tokens, output_tokens, month_year)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [userId, action, model, inputTokens, outputTokens, monthYear]);
}

module.exports = { canPerformAction, incrementCount, logUsage, getMonthlyCount, FREE_LIMIT };
```

---

### 3.3 Action Route

```js
// src/routes/action.js
const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const { runAction } = require('../services/ai');
const { canPerformAction, incrementCount, logUsage, getMonthlyCount, FREE_LIMIT } = require('../services/usage');

const VALID_ACTIONS = ['fix_grammar', 'rephrase', 'translate', 'summarize', 'explain'];

router.post('/',
  authMiddleware,
  [
    body('action').isIn(VALID_ACTIONS),
    body('text').isString().isLength({ min: 1, max: 5000 }),
    body('extra').optional().isString().isLength({ max: 200 }) // e.g. target language for translate
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { userId, plan } = req.user;
    const { action, text, extra } = req.body;

    // Check usage limit
    const allowed = await canPerformAction(userId, plan);
    if (!allowed) {
      const count = await getMonthlyCount(userId);
      return res.status(403).json({
        error: 'free_limit_reached',
        message: `You've used all ${FREE_LIMIT} free actions this month.`,
        count,
        limit: FREE_LIMIT
      });
    }

    try {
      const { result, model, input_tokens, output_tokens } = await runAction(action, text, extra);

      // Fire-and-forget DB writes
      incrementCount(userId).catch(console.error);
      logUsage(userId, action, model, input_tokens, output_tokens).catch(console.error);

      res.json({ result, model });
    } catch (err) {
      console.error('Action failed:', err);
      res.status(500).json({ error: 'ai_error', message: 'AI service unavailable. Please try again.' });
    }
  }
);

module.exports = router;
```

---

### 3.4 Auth Middleware

```js
// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../db/postgres');

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh plan from DB (in case it changed after token issued)
    const result = await db.query('SELECT id, email, plan, subscription_status FROM users WHERE id = $1', [decoded.userId]);
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });

    req.user = result.rows[0];
    req.user.userId = result.rows[0].id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};
```

---

## Phase 4 — Stripe Billing (Week 3)

### 4.1 Billing Routes

```js
// src/routes/billing.js
const router = require('express').Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const authMiddleware = require('../middleware/auth');
const db = require('../db/postgres');

// Create checkout session — user clicks "Upgrade to Pro"
router.post('/checkout', authMiddleware, async (req, res) => {
  const { email, userId } = req.user;

  let customerId = req.user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email, metadata: { userId } });
    customerId = customer.id;
    await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, userId]);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
    mode: 'subscription',
    success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/pricing`,
    metadata: { userId }
  });

  res.json({ url: session.url });
});

// Customer portal — manage / cancel subscription
router.post('/portal', authMiddleware, async (req, res) => {
  const session = await stripe.billingPortal.sessions.create({
    customer: req.user.stripe_customer_id,
    return_url: `${process.env.FRONTEND_URL}/dashboard`
  });
  res.json({ url: session.url });
});

// Stripe webhook — keep plan in sync
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const subscription = event.data.object;

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await db.query(`
        UPDATE users SET
          plan = $1,
          stripe_subscription_id = $2,
          subscription_status = $3,
          updated_at = NOW()
        WHERE stripe_customer_id = $4
      `, [
        subscription.status === 'active' ? 'pro' : 'free',
        subscription.id,
        subscription.status,
        subscription.customer
      ]);
      break;

    case 'customer.subscription.deleted':
      await db.query(`
        UPDATE users SET plan = 'free', subscription_status = 'canceled', updated_at = NOW()
        WHERE stripe_customer_id = $1
      `, [subscription.customer]);
      break;
  }

  res.json({ received: true });
});

module.exports = router;
```

---

## Phase 5 — Chrome Extension MV3 (Week 3–4)

### 5.1 Manifest

```json
{
  "manifest_version": 3,
  "name": "WriteAI — AI Writing Assistant",
  "version": "1.0.0",
  "description": "Fix grammar, translate, rephrase, summarize and explain text on any website.",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/content.js"],
      "css": ["content/toolbar.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

---

### 5.2 Content Script — Text Selection + Toolbar

```js
// content/content.js

let toolbar = null;
let selectedText = '';

document.addEventListener('mouseup', (e) => {
  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (text && text.length > 2) {
    selectedText = text;
    showToolbar(e.clientX, e.clientY);
  } else {
    hideToolbar();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideToolbar();
});

function showToolbar(x, y) {
  hideToolbar();

  toolbar = document.createElement('div');
  toolbar.id = 'writeai-toolbar';
  toolbar.innerHTML = `
    <div class="writeai-actions">
      <button data-action="fix_grammar" title="Fix Grammar">✏️ Fix</button>
      <button data-action="rephrase" title="Rephrase">🔄 Rephrase</button>
      <button data-action="translate" title="Translate">🌐 Translate</button>
      <button data-action="summarize" title="Summarize">📋 Summarize</button>
      <button data-action="explain" title="Explain">💡 Explain</button>
    </div>
    <div class="writeai-result" id="writeai-result" style="display:none">
      <div class="writeai-result-text" id="writeai-result-text"></div>
      <div class="writeai-result-actions">
        <button id="writeai-copy">Copy</button>
        <button id="writeai-replace">Replace</button>
        <button id="writeai-close">✕</button>
      </div>
    </div>
  `;

  // Position near selection
  const scrollY = window.scrollY;
  const scrollX = window.scrollX;
  toolbar.style.top = `${y + scrollY + 12}px`;
  toolbar.style.left = `${Math.min(x + scrollX, window.innerWidth - 320)}px`;

  document.body.appendChild(toolbar);

  // Action buttons
  toolbar.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;

      // Translate needs a target language
      let extra = '';
      if (action === 'translate') {
        extra = prompt('Translate to which language? (e.g. French, Urdu, Spanish)') || 'French';
      }

      await runAction(action, extra);
    });
  });

  // Result controls
  document.getElementById('writeai-copy')?.addEventListener('click', () => {
    const text = document.getElementById('writeai-result-text').innerText;
    navigator.clipboard.writeText(text);
  });

  document.getElementById('writeai-replace')?.addEventListener('click', () => {
    const text = document.getElementById('writeai-result-text').innerText;
    replaceSelectedText(text);
    hideToolbar();
  });

  document.getElementById('writeai-close')?.addEventListener('click', hideToolbar);
}

async function runAction(action, extra = '') {
  const resultBox = document.getElementById('writeai-result');
  const resultText = document.getElementById('writeai-result-text');
  resultBox.style.display = 'block';
  resultText.innerText = 'Thinking...';

  // Send to background service worker
  const response = await chrome.runtime.sendMessage({
    type: 'RUN_ACTION',
    action,
    text: selectedText,
    extra
  });

  if (response.error) {
    resultText.innerText = response.error === 'free_limit_reached'
      ? '⚡ You\'ve used all 20 free actions this month. Upgrade to Pro for unlimited access.'
      : '❌ Something went wrong. Please try again.';
  } else {
    resultText.innerText = response.result;
  }
}

function replaceSelectedText(replacement) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(replacement));
}

function hideToolbar() {
  toolbar?.remove();
  toolbar = null;
}
```

---

### 5.3 Background Service Worker

```js
// background/service-worker.js

const API_BASE = 'https://api.writeai.com'; // swap for localhost in dev

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RUN_ACTION') {
    handleAction(message).then(sendResponse);
    return true; // keep channel open for async
  }
  if (message.type === 'OPEN_AUTH') {
    openAuthTab();
    return true;
  }
});

// Listen for auth token from OAuth callback page
chrome.runtime.onMessageExternal.addListener((message, sender) => {
  if (message.type === 'WRITEAI_AUTH' && message.token) {
    chrome.storage.local.set({ token: message.token });
  }
});

async function handleAction({ action, text, extra }) {
  const { token } = await chrome.storage.local.get('token');

  if (!token) {
    openAuthTab();
    return { error: 'not_authenticated' };
  }

  try {
    const res = await fetch(`${API_BASE}/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action, text, extra })
    });

    const data = await res.json();
    if (!res.ok) return { error: data.error, message: data.message };
    return { result: data.result };
  } catch (err) {
    return { error: 'network_error' };
  }
}

function openAuthTab() {
  chrome.tabs.create({ url: `${API_BASE}/auth/google?extensionId=${chrome.runtime.id}` });
}
```

---

### 5.4 Toolbar CSS

```css
/* content/toolbar.css */

#writeai-toolbar {
  position: absolute;
  z-index: 2147483647;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08);
  padding: 8px;
  min-width: 290px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
}

.writeai-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.writeai-actions button {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
  color: #334155;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.writeai-actions button:hover {
  background: #6C63FF;
  color: #fff;
  border-color: #6C63FF;
}

.writeai-result {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
}

.writeai-result-text {
  color: #1e293b;
  line-height: 1.5;
  max-height: 150px;
  overflow-y: auto;
  margin-bottom: 8px;
  font-size: 13px;
}

.writeai-result-actions {
  display: flex;
  gap: 6px;
}

.writeai-result-actions button {
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid #e2e8f0;
}

#writeai-copy { background: #6C63FF; color: #fff; border-color: #6C63FF; }
#writeai-replace { background: #f1f5f9; color: #334155; }
#writeai-close { background: transparent; color: #94a3b8; border-color: transparent; margin-left: auto; }
```

---

## Phase 6 — User Route + Popup (Week 4)

### 6.1 User Route

```js
// src/routes/user.js
const router = require('express').Router();
const authMiddleware = require('../middleware/auth');
const { getMonthlyCount, FREE_LIMIT } = require('../services/usage');

router.get('/me', authMiddleware, async (req, res) => {
  const { userId, email, plan, subscription_status } = req.user;
  const count = await getMonthlyCount(userId);
  res.json({
    email,
    plan,
    subscription_status,
    usage: { count, limit: plan === 'pro' ? null : FREE_LIMIT }
  });
});

module.exports = router;
```

### 6.2 Popup

The popup shows:
- User avatar + email (if signed in)
- Usage meter: "14 / 20 actions used" (free) or "Unlimited" (pro)
- "Upgrade to Pro →" button (free users only) — calls `/billing/checkout`
- "Manage Subscription →" (pro users) — calls `/billing/portal`
- "Sign out" button

---

## Deployment

### Backend — Railway or Render

```bash
# Procfile
web: node src/app.js
```

Environment variables set in Railway dashboard. Provision:
- PostgreSQL plugin
- Redis plugin

Point `api.writeai.com` to the Railway service.

### Extension — Chrome Web Store

1. `zip` the `writeai-extension/` folder
2. Upload to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Fill in: description, screenshots (5 required), promo tile (440×280)
4. Set privacy policy URL → `writeai.com/privacy`
5. Submit for review (~3–7 days)

Update `EXTENSION_ORIGIN` in backend `.env` with the assigned extension ID after first submission.

---

## Cost Estimate (per month at scale)

| Item | Cost |
|------|------|
| Railway (backend + DB + Redis) | ~$20–40 |
| GPT-4o mini (1000 users × 200 actions × ~500 tokens) | ~$10–15 |
| Stripe fees (100 paying × $7 × 2.9%) | ~$20 |
| Domain + SSL | ~$2 |
| **Total at 100 paying users** | **~$52–77/mo** |
| **Revenue at 100 paying users** | **$700/mo** |
| **Margin** | **~89%** |

---

## Build Timeline Summary

| Week | Milestone |
|------|-----------|
| 1 | Project setup, DB schema, Google OAuth, JWT |
| 2 | AI action engine (GPT-4o mini + Gemini fallback), usage limits |
| 3 | Stripe billing, webhooks, subscription sync |
| 4 | Chrome extension — content script, toolbar, service worker, popup |
| 5 | End-to-end testing, Chrome Web Store listing, soft launch |

---

## API Reference (for extension developer)

| Method | Endpoint | Auth | Body | Response |
|--------|----------|------|------|----------|
| GET | `/auth/google` | None | — | Redirect to Google |
| GET | `/auth/verify` | JWT | — | `{ user }` |
| POST | `/action` | JWT | `{ action, text, extra? }` | `{ result, model }` |
| GET | `/user/me` | JWT | — | `{ email, plan, usage }` |
| POST | `/billing/checkout` | JWT | — | `{ url }` |
| POST | `/billing/portal` | JWT | — | `{ url }` |
| POST | `/billing/webhook` | Stripe sig | Raw body | `{ received }` |
