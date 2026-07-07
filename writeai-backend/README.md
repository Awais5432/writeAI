# WriteAI Backend

Node.js API for the WriteAI Chrome extension — Google OAuth, AI actions, usage limits, Stripe billing, and admin master panel.

## Quick start

```bash
cd writeai-backend
cp .env.example .env
# Fill in API keys, ADMIN_EMAILS, and database URL

npm install
npm run migrate
npm run dev
```

Health check: `GET http://localhost:3000/health`  
Admin panel: `GET http://localhost:3000/admin`

## Local databases (Docker)

From the repo root:

```bash
docker compose up -d
```

This starts PostgreSQL (`localhost:5432`) and Redis (`localhost:6379`) with credentials matching `.env.example`.

If Docker is not available, point `DATABASE_URL` at any PostgreSQL instance and run `npm run migrate`.

Or run the all-in-one setup:

```bash
npm run setup
```

## Admin master panel

URL: `http://localhost:3000/admin`

**Login:** username + password stored in the `panel_admins` database table (not Google).

Default credentials (after `npm run seed:admin`):

| Field | `.env` variable | Default |
|-------|-----------------|---------|
| Username | `ADMIN_USERNAME` | `admin` |
| Password | `ADMIN_PASSWORD` | set in `.env` |

```bash
npm run seed:admin   # create/update admin from .env
```

Features: dashboard stats, user CRUD (plan, enable/disable, delete), subscriptions, usage logs, AI model config.

Extension users still sign in with **Google**. The master panel uses a **separate DB login**.

## Environment

See `.env.example` for all variables. Required for local dev:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — random secret for signing tokens
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth credentials
- `OPENAI_API_KEY` — primary AI provider (Gemini optional fallback)

Stripe and Redis are optional until billing / rate limiting are needed.

## API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | — | Health check |
| GET | `/auth/google` | — | Start Google OAuth |
| GET | `/auth/google/callback` | — | OAuth callback |
| GET | `/auth/verify` | JWT | Verify token |
| POST | `/action` | JWT | Run AI action |
| GET | `/user/me` | JWT | User profile + usage |
| POST | `/billing/checkout` | JWT | Stripe checkout |
| POST | `/billing/portal` | JWT | Stripe customer portal |
| POST | `/billing/webhook` | Stripe sig | Subscription webhooks |

## Deploy

Railway / Render with `Procfile`:

```
web: node src/server.js
```

Provision PostgreSQL and Redis, set env vars, run migrations on deploy.
