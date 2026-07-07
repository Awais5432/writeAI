# writeAI

Chrome extension + Node.js API for AI writing actions on any webpage.

**Landing page** is handled separately by the frontend dev (Next.js).

## What's included

| Component | Path | Description |
|-----------|------|-------------|
| API Backend | `writeai-backend/` | Auth, AI actions, billing, usage limits |
| Master Panel | `http://localhost:3000/admin` | Admin dashboard for users, subscriptions, usage, models |
| Chrome Extension | `writeai-extension/` | Text selection toolbar + popup |

## Quick start

### 1. Start databases

```powershell
docker compose up -d
```

### 2. Backend setup

```powershell
cd writeai-backend
copy .env.example .env
# Edit .env: GOOGLE_CLIENT_ID, OPENAI_API_KEY, ADMIN_EMAILS (your Google email)
npm install
npm run migrate
npm run dev
```

### 3. Load extension

1. Open `chrome://extensions` → Developer mode → Load unpacked
2. Select the `writeai-extension` folder
3. Copy extension ID into `EXTENSION_ORIGIN` in `.env`

### 4. Admin panel

Open [http://localhost:3000/admin](http://localhost:3000/admin) and sign in with a Google account listed in `ADMIN_EMAILS`.

## Master panel features

- **Overview** — user counts, monthly actions, model/action breakdown
- **Users** — search, change plan (free/pro), enable/disable accounts
- **Subscriptions** — Stripe customer and subscription status
- **Usage logs** — per-action history with model and token counts
- **Models & limits** — toggle GPT/Gemini, set primary/fallback model, free tier limit

## Production deploy

### Option A — Hostinger Node.js (recommended for your plan)

Your Business plan supports **Express.js** directly — no Render needed. One deploy serves landing, login, app, API, and admin.

1. hPanel → **Websites** → **Add Website** → **Node.js Apps**
2. Deploy via **GitHub** (`https://github.com/Awais5432/writeAI`) or **upload zip**:
   ```powershell
   cd "d:\AI Writer"
   node scripts/zip-hostinger-node.js
   ```
   Upload `deploy/writeai-backend.zip`
3. Build settings:
   - Framework: **Express.js** (or **Other**)
   - Entry file: `src/server.js`
   - Build command: `npm install && npm run migrate`
   - Start command: `npm start`
   - Node.js version: **20.x** or **22.x**
4. Environment variables: copy from `deploy/hostinger.env.example` (paste Neon `DATABASE_URL` in hPanel only)
5. Connect domain: `websrowitservices.com` or create subdomain `demo.websrowitservices.com`

**Google OAuth:** set callback to `https://websrowitservices.com/auth/google/callback` and origin to same domain.

**Note:** If the domain already has a static/WordPress site, Hostinger requires removing it first, then adding as Node.js app (backup first).

### Option B — Split (Hostinger static + Render API)

Use if you prefer static files only on Hostinger. See `deploy/render.env.example` and `node scripts/build-hostinger.js`.

## Production checklist

- [ ] Neon `DATABASE_URL` in Hostinger env (not in git)
- [ ] `FRONTEND_URL` matches your live domain exactly
- [ ] Google OAuth callback on same domain
- [ ] `npm run migrate` ran on deploy (in build command)
- [ ] Extension `API_BASE` → `https://websrowitservices.com` if using extension

See `writeai-engineering-plan.md` for full architecture and API reference.
