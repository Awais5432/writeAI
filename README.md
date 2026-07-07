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

## Production checklist

- [ ] Set strong `JWT_SECRET`
- [ ] Configure Google OAuth with production callback URL
- [ ] Add OpenAI + Stripe keys
- [ ] Set `ADMIN_EMAILS` to your admin Google accounts
- [ ] Deploy backend (Railway/Render) + run migrations
- [ ] Update extension `API_BASE` to production URL
- [ ] Submit extension to Chrome Web Store

See `writeai-engineering-plan.md` for full architecture and API reference.
