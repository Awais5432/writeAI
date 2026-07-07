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

## Production deploy (Render API + Neon DB + Hostinger static)

Split setup for shared hosting: **API on Render (free)**, **database on Neon**, **landing/login/app on Hostinger**.

### 1. Render — API only (free)

1. [render.com](https://render.com) → **New** → **Blueprint** → connect [github.com/Awais5432/writeAI](https://github.com/Awais5432/writeAI)
2. Blueprint uses `plan: free` — no Render Postgres (Neon only)
3. Set env vars from `deploy/render.env.example` (paste Neon `DATABASE_URL` in Render dashboard only — never commit it)
4. After first deploy, note URL: `https://writeai-api.onrender.com` (or your service name)
5. Test: `https://YOUR-API.onrender.com/health`
6. Admin panel: `https://YOUR-API.onrender.com/admin`

### 2. Google OAuth

| Setting | Value |
|---------|--------|
| Authorized JavaScript origins | `https://demo.yourdomain.com` |
| Redirect URI | `https://YOUR-API.onrender.com/auth/google/callback` |

Update Render env: `GOOGLE_CALLBACK_URL` and `FRONTEND_URL=https://demo.yourdomain.com`

### 3. Hostinger — static frontend

```powershell
node scripts/build-hostinger.js https://YOUR-API.onrender.com
```

Upload everything in `deploy/hostinger/` to your demo subdomain folder (`public_html/demo` or similar). `.htaccess` is included for `/login` and `/app` routes.

### 4. Extension (optional)

Set `API_BASE` in `writeai-extension/background/service-worker.js` and `utils/api.js` to your Render URL. Add host permission in `manifest.json`.

## Production checklist

- [ ] Neon `DATABASE_URL` set in Render (not in git)
- [ ] `FRONTEND_URL` matches Hostinger demo subdomain exactly
- [ ] Google OAuth callback on API host
- [ ] `node scripts/build-hostinger.js` + upload to Hostinger
- [ ] Extension `API_BASE` updated if using extension in demo

See `writeai-engineering-plan.md` for full architecture and API reference.
